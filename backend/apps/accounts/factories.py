"""
factory-boy factories for the accounts app.

Shared by the whole test suite for building Users (in every role) and linked
StudentProfiles without repeating boilerplate. Passwords are hashed via
``set_password`` so credential-based login tests work against them.
"""

import factory

from .models import StudentProfile, User

DEFAULT_PASSWORD = "test-pass-12345"


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
        django_get_or_create = ("email",)
        # NB: do NOT skip the post-generation save — ``set_password`` mutates the
        # instance and must be persisted for credential login to work.

    email = factory.Sequence(lambda n: f"user{n}@test.mx")
    first_name = "Test"
    last_name = factory.Sequence(lambda n: f"User{n}")
    role = User.Role.PARENT
    password = factory.PostGenerationMethodCall("set_password", DEFAULT_PASSWORD)


class ParentFactory(UserFactory):
    role = User.Role.PARENT
    email = factory.Sequence(lambda n: f"parent{n}@test.mx")


class AdminFactory(UserFactory):
    role = User.Role.ADMIN
    is_staff = True
    email = factory.Sequence(lambda n: f"admin{n}@test.mx")


class StudentUserFactory(UserFactory):
    role = User.Role.STUDENT
    email = factory.Sequence(lambda n: f"student{n}@test.mx")


class StudentProfileFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentProfile

    user = factory.SubFactory(StudentUserFactory)
    student_id = factory.Sequence(lambda n: f"S{n:05d}")
    grade = "3° Primaria"
    group = "A"
    loyverse_id = factory.Sequence(lambda n: f"loy-{n}")

    @factory.post_generation
    def parents(self, create, extracted, **kwargs):
        if create and extracted:
            for parent in extracted:
                self.parents.add(parent)
