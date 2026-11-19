# Sourced by backup-db.sh (and by backend/apps/core/test_backup_offsite.py):
# encrypt a database dump before ANY copy of it leaves this box.
#
#   encrypt_dump <dump.sql.gz> <out.sql.gz.gpg> <backup-public-key.asc>
#
# Prints nothing and returns 0 on success. On failure it deletes <out>,
# prints the reason in Spanish (it is shown in the admin console) and returns 1.
#
# Fail closed, like .github/workflows/db-backup.yml: the key file must be the
# school's (pinned fingerprint), the result must NOT read as gzip, and gpg must
# see a message encrypted to that key's encryption subkey. Public key only:
# the private key is never needed here and must never be on this path.
#
# gpg runs with a throwaway GNUPGHOME, so nothing is imported into anyone's
# keyring and no secret key is ever within reach; its agent is stopped and the
# directory deleted before returning.

# The primary key of deploy/backup-public-key.asc. Rotating the key means
# replacing the file, this line and BACKUP_KEY_IDS in backend/apps/core/backups.py
# together (a test pins the three to each other).
BACKUP_KEY_FINGERPRINT="AAA0DA4256F7EC7A752477B06574D2D47EC9E0A2"

encrypt_dump() {
  local in="$1" out="$2" key="$3" home fpr subkey packets reason=""
  if ! command -v gpg >/dev/null 2>&1; then
    echo "gpg no está instalado en el servidor"; return 1
  fi
  if [[ ! -s "$key" ]]; then
    echo "falta la llave pública $(basename "$key")"; return 1
  fi
  if [[ ! -s "$in" ]]; then
    echo "no existe el volcado $(basename "$in")"; return 1
  fi
  home=$(mktemp -d 2>/dev/null) || { echo "no se pudo crear un directorio temporal para gpg"; return 1; }
  chmod 700 "$home"
  rm -f "$out"

  fpr=$(GNUPGHOME="$home" gpg --batch --with-colons --show-keys "$key" 2>/dev/null \
        | awk -F: '$1=="fpr" {print $10; exit}')
  subkey=$(GNUPGHOME="$home" gpg --batch --with-colons --show-keys "$key" 2>/dev/null \
        | awk -F: '$1=="sub" && $12 ~ /e/ {print $5; exit}')
  if [[ "$fpr" != "$BACKUP_KEY_FINGERPRINT" ]]; then
    reason="la llave pública no es la del colegio (huella ${fpr:-ilegible})"
  elif [[ -z "$subkey" ]]; then
    reason="la llave pública no tiene subllave de cifrado"
  elif ! GNUPGHOME="$home" gpg --batch --quiet --yes --trust-model always \
         --recipient-file "$key" --output "$out" --encrypt "$in" 2>/dev/null; then
    reason="gpg no pudo cifrar el volcado"
  elif gunzip -t < "$out" >/dev/null 2>&1; then
    # The check that matters most: a file that still reads as gzip is the clear dump.
    reason="el archivo cifrado todavía se lee como gzip"
  else
    # No secret key exists in this home, so gpg only lists the packets (and
    # then reports it cannot decrypt, hence the || true).
    packets=$(GNUPGHOME="$home" gpg --batch --list-packets "$out" 2>/dev/null || true)
    if ! grep -q ":pubkey enc packet: .*keyid ${subkey}" <<<"$packets"; then
      reason="el archivo no es un mensaje GPG cifrado para la llave del colegio"
    fi
  fi

  GNUPGHOME="$home" gpgconf --kill all >/dev/null 2>&1 || true
  rm -rf "$home"
  if [[ -n "$reason" ]]; then
    rm -f "$out"
    echo "$reason"; return 1
  fi
  return 0
}
