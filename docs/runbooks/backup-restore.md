# Runbook: database backups and restores

Nightly encrypted backups of the production MongoDB (CC-108), and how to get the data back.

|               |                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Workflow      | `.github/workflows/backup.yml`, every night at 03:17 UTC, and by hand (Actions → **Run workflow**)     |
| What          | `mongodump --gzip --archive` of the production database, streamed straight into `age` (encrypted)      |
| Where         | The owner's private S3 compatible bucket, key `mongo/classicade-<UTC time>.archive.gz.age`             |
| Kept for      | 30 days, by the bucket's lifecycle rule                                                                |
| Who can read  | Only the holder of the age **private** key. GitHub, the bucket provider and the workflow never have it |
| Until set up  | Every run skips with the notice "Backup skipped". Nothing fails                                        |
| Restore tools | `scripts/bin/backup.mjs restore` and `summary`, below                                                  |

The repository is public, and so are its Actions logs and artifacts. So the backup is encrypted before it touches
the disk, it is never an Actions artifact or cache, the dump runs with `--quiet` so no collection names or counts are
logged, and the database password is masked in every log line. The workflow checks before every run that the
database user can only read, and refuses to run if it can do more.

## One time setup (owner)

Do these in order. Nothing secret goes in the repository, an issue, a PR or a chat.

### 1. A read only database user in Atlas

1. Atlas → your project → **Database Access** → **Add New Database User**.
2. Authentication: **Password**. User name e.g. `classicade-backup`. Autogenerate a long password.
3. **Built-in Role: Only read any database** (`readAnyDatabase`). Nothing else. A role with any write right makes
   the backup refuse to run ("The backup user can do more than read").
4. **Network Access**: GitHub's runners have changing addresses. The access list must allow them, which in practice
   means `0.0.0.0/0` (the Render app on the free plan usually needs that already). The strong password is the guard.
5. The connection string: Atlas → **Connect** → **Drivers**, then put in the user, the password and the database
   name. The database name is the one in Render's `MONGO_URI` (the part after the host, `test` when there is none):

   ```
   mongodb+srv://classicade-backup:<password>@cluster0.xxxxx.mongodb.net/<database>?retryWrites=true&w=majority
   ```

   Characters like `@ : / ? # %` in the password must be URL encoded (`node -p 'encodeURIComponent(process.argv[1])' '<password>'`).

### 2. The encryption key pair

On your own computer (`brew install age`, or `apt install age`):

```bash
age-keygen -o ~/classicade-backup-key.txt     # prints "Public key: age1..."
```

- The file holds the **private key**. Keep it in your password manager and one more safe place (a second password
  manager entry or an encrypted USB stick). Without it no backup can ever be read. Never put it in GitHub.
- The **public key** (`age1...`) goes into the `BACKUP_AGE_RECIPIENTS` secret. One key per line, so a second key
  (a spare you keep offline) can be added, and either one can decrypt.

### 3. A private bucket with 30 day retention

Any S3 compatible store works. Pick one:

| Provider      | Bucket                                                                                          | 30 day retention                                                                      | Key for the workflow                                                                                                                                                              | `BACKUP_S3_ENDPOINT`                            | `BACKUP_S3_REGION`  |
| ------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------- |
| Cloudflare R2 | R2 → **Create bucket** `classicade-backups`. Leave public access **off** (no r2.dev, no domain) | Bucket → Settings → **Object lifecycle rules**: prefix `mongo/`, delete after 30 days | R2 → **Manage API tokens** → Object Read & Write, **only this bucket**. Optionally add a **bucket lock** rule of 30 days on `mongo/`, so not even a leaked key can delete backups | `https://<account id>.r2.cloudflarestorage.com` | not needed (`auto`) |
| Backblaze B2  | **Private** bucket                                                                              | Lifecycle: hide after 30 days, delete 1 day after hiding                              | Application key for this bucket with only `writeFiles`                                                                                                                            | `https://s3.<region>.backblazeb2.com`           | e.g. `us-west-004`  |
| AWS S3        | Block all public access **on**                                                                  | Lifecycle rule on prefix `mongo/`: expire current versions after 30 days              | IAM user with only `s3:PutObject` on `arn:aws:s3:::<bucket>/mongo/*`                                                                                                              | `https://s3.<region>.amazonaws.com`             | e.g. `eu-west-1`    |

Retention is the bucket's job, not the workflow's, so the workflow's key needs no right to delete. Note that the
lifecycle rule deletes old backups whether or not new ones arrive: if backups stop for 30 days, there are none left.
GitHub emails you when a scheduled run fails, so act on those emails.

### 4. The repository secrets

GitHub → repository **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Secrets,
not variables: variables are visible to anyone.

| Secret                        | Value                                                                       |
| ----------------------------- | --------------------------------------------------------------------------- |
| `BACKUP_MONGO_URI`            | The read only connection string from step 1                                 |
| `BACKUP_AGE_RECIPIENTS`       | The public key(s) from step 2, `age1...`, one per line                      |
| `BACKUP_S3_ENDPOINT`          | From the table in step 3, `https://...`                                     |
| `BACKUP_S3_BUCKET`            | The bucket name only, e.g. `classicade-backups`                             |
| `BACKUP_S3_ACCESS_KEY_ID`     | The bucket key's id                                                         |
| `BACKUP_S3_SECRET_ACCESS_KEY` | The bucket key's secret                                                     |
| `BACKUP_S3_REGION`            | Optional. Only for B2 and AWS (see step 3). Without it the region is `auto` |

With none of the six required secrets set, runs skip. With some but not all, or one in the wrong shape, the run fails
and says which one, so a half finished setup is never mistaken for a working one.

### 5. First run

Actions → **Nightly database backup** → **Run workflow**. A good run shows:

- "Read only: yes (readAnyDatabase@admin). Database &lt;name&gt;: N collections."
- a summary "Encrypted archive of N bytes, uploading as `mongo/classicade-....archive.gz.age`",
- and that object in the bucket.

Then do a rehearsal (below) right away. A backup is only proven once it has been restored.

## Restore into a scratch database and verify

Never restore into production with these steps. The helper only writes into an **empty** database whose name starts
with `restore_`, and refuses anything else.

1. **Tools**, on your computer: Node (`nvm use`, then `npm ci` in the repository), `age`, and the MongoDB Database
   Tools (`brew install mongodb-database-tools age`, or the packages from mongodb.com and your system).
2. **Download a backup** from the bucket's web console, or with your own credentials (not the workflow's key):

   ```bash
   aws s3 ls "s3://classicade-backups/mongo/" --endpoint-url "$ENDPOINT"
   aws s3 cp "s3://classicade-backups/mongo/classicade-2026-10-16T03-17-41Z.archive.gz.age" . --endpoint-url "$ENDPOINT"
   ```

3. **Start a scratch MongoDB** that has nothing to do with production:

   ```bash
   docker run --rm -d --name restore-check -p 127.0.0.1:27017:27017 mongo:8
   ```

4. **Decrypt and restore** in one go. Decrypted data only ever flows from `age` into `mongorestore` and is never
   written to disk:

   ```bash
   node scripts/bin/backup.mjs restore \
     --archive classicade-2026-10-16T03-17-41Z.archive.gz.age \
     --identity ~/classicade-backup-key.txt \
     --uri mongodb://127.0.0.1:27017 \
     --from-db <production database name> \
     --to-db restore_2026_10_16
   ```

   It prints each collection with its document and index counts.

5. **Verify**:
   - Compare the counts with production (counts only, no data shown):
     `node scripts/bin/backup.mjs summary --uri "<read only connection string>" --db <production database name>`.
     `users` and `matches` should match or be a little lower (the backup is from last night). `player_sessions`
     changes all the time, so a difference there is normal.
   - Every collection has its indexes (more than the 1 that `_id` gets, where the app defines indexes).
   - Run the app on the copy and sign in with your own account:
     `MONGO_URI=mongodb://127.0.0.1:27017/restore_2026_10_16 npm run dev:server` (with the rest of
     `apps/server/.env`), then `npm run dev:web` and open http://localhost:5173. Your level and match history should
     be there.
6. **Clean up**: `docker stop restore-check` (the container and its data go away) and delete the downloaded file.

### If production data is really lost

Restore into a **new** database on the Atlas cluster (or a new cluster), check it as above, then point Render's
`MONGO_URI` at it. With an admin connection string for the new place:

```bash
age --decrypt --identity ~/classicade-backup-key.txt classicade-<time>.archive.gz.age |
  mongorestore --uri "<admin connection string, no database>" --gzip --archive \
    --nsInclude '<old db>.*' --nsFrom '<old db>.*' --nsTo '<new db>.*'
```

Changing `MONGO_URI` logs everyone out (sessions are in the database too). Note the incident in docs/DEPLOYMENT.md.

#### Accounts deleted since the backup (CC-035)

A backup made before a player deleted their account still holds that account. Restoring it would bring the account
back, which the player was promised would not happen. So, **before** restoring, copy two collections from the live
database, if it can still be read, and put them back afterwards:

1. `account_deletions`: one record per account deleted in the last 30 days (the player id only). The backups are
   kept 30 days too, so every deletion a backup could undo is in it.
2. `legacy_closures`: the legacy rows whose player deleted their account (the legacy row id only), kept for ever.

```bash
mongoexport --uri "<live connection string>" --collection account_deletions --out deletions.json
mongoexport --uri "<live connection string>" --collection legacy_closures --out closures.json
# restore the backup as above, then:
mongoimport --uri "<new connection string>" --collection legacy_closures --mode upsert --upsertFields legacyId --file closures.json
mongoimport --uri "<new connection string>" --collection account_deletions --mode upsert --upsertFields playerId --file deletions.json
mongosh "<new connection string>" --eval 'db.account_deletions.updateMany({}, { $set: { sweepAgainAt: new Date() } })'
```

Within a minute the server's housekeeping deletes each of those accounts again, store by store
(`playerDataComponent.sweepDue`), and logs "account deletion swept again" for each player id. Delete
`deletions.json` and `closures.json` afterwards. If the live database cannot be read at all, the deletions of the days
since the backup cannot be known: say so in the incident note, and delete any account whose player asks again.

## Rehearsal checklist

Do this after the first backup, then every three months, and after any change to the backup workflow or the
database. Record the date and result in docs/DEPLOYMENT.md under Incidents (as "rehearsal").

- [ ] The last 7 nightly runs are green, or skipped only before setup.
- [ ] The bucket holds about 30 days of backups and nothing older (the lifecycle rule works).
- [ ] The bucket is not public: opening an object's URL without credentials is refused.
- [ ] The newest backup downloads and its size is in line with earlier ones.
- [ ] It decrypts with the private key from the password manager (not a copy lying around).
- [ ] The restore into a `restore_` database succeeds and the counts match production as described above.
- [ ] Signing in to the app running on the restored copy works.
- [ ] The Atlas backup user still has only "Only read any database" (the run log says "Read only: yes").
- [ ] The scratch database and downloaded file are deleted.
- [ ] Time taken, from download to verified: \_\_\_ minutes.

## When the backup fails

GitHub emails the owner when a scheduled run fails. Open the run; the failing step says why.

| Message                                         | Fix                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Backups are half set up. Missing secrets: ...   | Add the named secrets (step 4)                                                             |
| The backup user can do more than read (...)     | Atlas → Database Access → edit the user → only "Only read any database"                    |
| Database "x" has no collections                 | The database name in `BACKUP_MONGO_URI` is wrong (step 1.5)                                |
| Server selection timed out / querySrv ENOTFOUND | The Atlas cluster is paused (resume it) or the access list does not allow GitHub's runners |
| An `aws s3 cp` error (403, NoSuchBucket)        | Bucket name, endpoint, region or key permissions (step 3)                                  |

## Changing the tools

`.github/actions/backup-tools/action.yml` pins the MongoDB Database Tools version and its SHA 256 from MongoDB's
release list, and installs `age` from Ubuntu. The CI job "Backup round trip" runs the real pipeline on every PR
(dump with a read only user, encrypt, decrypt, restore, compare every document and index), so an upgrade that breaks
it fails CI. The same test runs locally with `npx vitest run scripts/backup/roundTrip.integration.test.mjs` when the
tools are installed, and is skipped otherwise.
