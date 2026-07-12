"""
Accounts views: Google OAuth flow, JWT token exchange, user profile, students list.
"""
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.contrib.auth import logout
from django.shortcuts import redirect
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.core.ratelimit import ratelimit

from .cookies import (clear_auth_cookies, csrf_ok, issue_session,
                      new_csrf_token, set_csrf_cookie, set_refresh_cookie)
from .models import StudentProfile, User
from .serializers import StudentProfileSerializer, UserSerializer


class GoogleLoginView(APIView):
    """
    Redirects user to Google's OAuth consent screen.
    Used by the frontend button: GET /auth/google/
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        # Fail gracefully to the SPA login instead of sending the user to Google
        # with blank credentials (which yields a confusing Google error page)
        # when OAuth isn't configured in this environment.
        if not (settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET):
            return redirect(f'{settings.FRONTEND_URL}/login?error=google_unavailable')

        # Build the consent URL with proper URL-encoding of every parameter.
        # `redirect_uri` must EXACTLY match one of the "Authorized redirect URIs"
        # registered on the OAuth client in Google Cloud Console (scheme, host,
        # port and trailing slash all count) — otherwise Google returns
        # Error 400: redirect_uri_mismatch. It is read from GOOGLE_REDIRECT_URI.
        params = urlencode({
            'client_id': settings.GOOGLE_CLIENT_ID,
            'redirect_uri': settings.GOOGLE_REDIRECT_URI,
            'response_type': 'code',
            'scope': 'openid email profile',
            'access_type': 'offline',
            'prompt': 'select_account',
        })
        return redirect(f'https://accounts.google.com/o/oauth2/v2/auth?{params}')


@method_decorator(ratelimit('oauth-callback', '20/m', key='ip', method='GET'), name='dispatch')
class GoogleCallbackView(APIView):
    """
    Handles the OAuth callback from Google.
    Exchanges code → access_token → user info, creates/finds user, returns JWT.
    GET /auth/google/callback/?code=...
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        code = request.GET.get('code')
        if not code:
            return redirect(f'{settings.FRONTEND_URL}/login?error=no_code')

        # Exchange code → token → userinfo. Any network failure or malformed
        # response redirects to the login with an error rather than a raw 500.
        try:
            token_response = requests.post(
                'https://oauth2.googleapis.com/token',
                data={
                    'code': code,
                    'client_id': settings.GOOGLE_CLIENT_ID,
                    'client_secret': settings.GOOGLE_CLIENT_SECRET,
                    'redirect_uri': settings.GOOGLE_REDIRECT_URI,
                    'grant_type': 'authorization_code',
                },
                timeout=10,
            )
            if token_response.status_code != 200:
                return redirect(f'{settings.FRONTEND_URL}/login?error=token_exchange_failed')
            access_token = token_response.json().get('access_token')

            # Get user info from Google
            userinfo_response = requests.get(
                'https://www.googleapis.com/oauth2/v3/userinfo',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10,
            )
            if userinfo_response.status_code != 200:
                return redirect(f'{settings.FRONTEND_URL}/login?error=userinfo_failed')
            userinfo = userinfo_response.json()
        except (requests.RequestException, ValueError):
            return redirect(f'{settings.FRONTEND_URL}/login?error=google_unreachable')
        google_id = userinfo.get('sub')
        email = userinfo.get('email')
        first_name = userinfo.get('given_name', '')
        last_name = userinfo.get('family_name', '')
        avatar = userinfo.get('picture', '')

        if not email:
            return redirect(f'{settings.FRONTEND_URL}/login?error=no_email')

        # Create or update user
        user, created = User.objects.get_or_create(email=email, defaults={
            'first_name': first_name,
            'last_name': last_name,
            'google_id': google_id,
            'avatar': avatar,
            'role': User.Role.PARENT,  # default role; admin assigns final role
        })

        if not created:
            # Update profile picture and google_id if changed
            updated = False
            if user.google_id != google_id:
                user.google_id = google_id
                updated = True
            if avatar and user.avatar != avatar:
                user.avatar = avatar
                updated = True
            if updated:
                user.save(update_fields=['google_id', 'avatar'])

        # Set the session as httpOnly cookies and redirect WITHOUT any token in
        # the URL. Land on /login (NOT /auth/*, which is reserved for the backend
        # — the Vite proxy and the SPA catch-all both route /auth/* to Django);
        # LoginPage sees ?login=ok and silently mints an in-memory access token
        # from the cookie via the refresh endpoint.
        response = redirect(f'{settings.FRONTEND_URL}/login?login=ok')
        issue_session(user, response)
        return response


@method_decorator(ratelimit('google-token', '10/m', key='ip', method='POST'), name='dispatch')
class GoogleTokenView(APIView):
    """
    POST /api/v1/accounts/google/token/
    Alternative: frontend sends { credential: <google_id_token> } and gets JWT back.
    Uses Google's tokeninfo endpoint to validate.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        credential = request.data.get('credential')
        if not credential:
            return Response({'error': 'credential required'}, status=status.HTTP_400_BAD_REQUEST)

        # Verify the ID token LOCALLY (signature + audience + expiry) instead of
        # GETting Google's tokeninfo endpoint with the credential in the URL
        # (IK-SEC A4: no token in a URL). Raises ValueError on any invalid token.
        try:
            payload = google_id_token.verify_oauth2_token(
                credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID)
        except ValueError:
            return Response({'error': 'invalid_token'}, status=status.HTTP_401_UNAUTHORIZED)

        email = payload.get('email')
        if not email:
            return Response({'error': 'no_email'}, status=status.HTTP_400_BAD_REQUEST)

        user, _ = User.objects.get_or_create(email=email, defaults={
            'first_name': payload.get('given_name', ''),
            'last_name': payload.get('family_name', ''),
            'google_id': payload.get('sub', ''),
            'avatar': payload.get('picture', ''),
            'role': User.Role.PARENT,
        })

        response = Response()
        access = issue_session(user, response)
        response.data = {'user': UserSerializer(user).data, 'access': access}
        return response


class LogoutView(APIView):
    """POST /auth/logout/ — Blacklist the refresh cookie's token and clear cookies."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not csrf_ok(request):
            return Response({'detail': 'CSRF token inválido.'},
                            status=status.HTTP_403_FORBIDDEN)
        raw = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE)
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass  # already invalid/expired/blacklisted — still clear cookies
        response = Response({'detail': 'Sesión cerrada correctamente.'})
        clear_auth_cookies(response)
        logout(request)
        return response


@method_decorator(ratelimit('login', '10/m', key='ip', method='POST'), name='dispatch')
class RateLimitedTokenObtainView(TokenObtainPairView):
    """POST /api/v1/accounts/token/ — email/password login, IP rate-limited.

    On success the refresh token is set as an httpOnly cookie (+ CSRF cookie) and
    stripped from the body; only the short-lived access token is returned.
    """

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            refresh = response.data.get('refresh')
            access = response.data.get('access')
            response.data = {'access': access}
            if refresh:
                set_refresh_cookie(response, refresh)
                set_csrf_cookie(response, new_csrf_token())
        return response


@method_decorator(ratelimit('token-refresh', '60/m', key='ip', method='POST'), name='dispatch')
class CookieTokenRefreshView(APIView):
    """POST /api/v1/accounts/token/refresh/ — rotate the httpOnly refresh cookie.

    Reads the refresh token from the cookie (never the body), requires a valid
    double-submit CSRF header, rotates (blacklisting the old token), re-sets the
    cookie, and returns a fresh in-memory access token.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        if not csrf_ok(request):
            return Response({'detail': 'CSRF token inválido.'},
                            status=status.HTTP_403_FORBIDDEN)
        raw = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE)
        if not raw:
            return Response({'detail': 'No hay sesión activa.'},
                            status=status.HTTP_401_UNAUTHORIZED)

        # Reuse SimpleJWT's serializer so rotation + blacklist semantics are
        # identical to the stock TokenRefreshView (a blacklisted/expired token
        # raises here and the session is cleared).
        serializer = TokenRefreshSerializer(data={'refresh': raw})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, InvalidToken):
            response = Response({'detail': 'Sesión expirada.'},
                                status=status.HTTP_401_UNAUTHORIZED)
            clear_auth_cookies(response)
            return response

        data = serializer.validated_data
        response = Response({'access': data['access']})
        set_refresh_cookie(response, data.get('refresh', raw))
        set_csrf_cookie(response, new_csrf_token())
        return response


class CurrentUserView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/accounts/me/"""
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class StudentListView(generics.ListAPIView):
    """GET /api/v1/accounts/students/?search= — List students (admin only or parent's own children)."""
    serializer_class = StudentProfileSerializer
    permission_classes = [permissions.IsAuthenticated]
    # Powers the admin Ctrl+K palette (global SearchFilter backend applies).
    search_fields = ['user__first_name', 'user__last_name', 'user__email',
                     'student_id', 'grade']

    def get_queryset(self):
        user = self.request.user
        if user.role == User.Role.ADMIN:
            return StudentProfile.objects.select_related('user').all()
        elif user.role == User.Role.PARENT:
            # Return only children linked to this parent
            return StudentProfile.objects.filter(parents=user).select_related('user')
        return StudentProfile.objects.none()


class StudentDetailView(generics.RetrieveAPIView):
    """GET /api/v1/accounts/students/<pk>/"""
    serializer_class = StudentProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == User.Role.ADMIN:
            return StudentProfile.objects.all()
        elif user.role == User.Role.PARENT:
            return StudentProfile.objects.filter(parents=user)
        elif user.role == User.Role.STUDENT:
            return StudentProfile.objects.filter(user=user)
        return StudentProfile.objects.none()
