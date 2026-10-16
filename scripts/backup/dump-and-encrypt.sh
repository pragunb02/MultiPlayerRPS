#!/usr/bin/env bash
# Dumps the database named in BACKUP_MONGO_URI and encrypts it for the public keys in the recipients file.
# The compressed dump is streamed straight into age, so unencrypted data never touches the disk.
# Used by .github/workflows/backup.yml and by the round trip test, so both run exactly the same pipeline.
#
#   BACKUP_MONGO_URI=... scripts/backup/dump-and-encrypt.sh <recipients file> <output file>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: BACKUP_MONGO_URI=... $0 <recipients file> <output file>" >&2
  exit 2
fi
: "${BACKUP_MONGO_URI:?BACKUP_MONGO_URI must be set}"

recipients_file="$1"
output_file="$2"

# Only this user may read the encrypted file while it exists.
umask 077
# The quiet flag keeps collection names and progress out of the log.
mongodump --uri="$BACKUP_MONGO_URI" --gzip --archive --quiet |
  age --encrypt --recipients-file "$recipients_file" --output "$output_file"
