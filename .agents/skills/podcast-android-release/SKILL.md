---
name: podcast-android-release
description: Prepare and verify Android APK releases for the Podcast App repository. Use for release version bumps, tag preparation, release workflow failures, or instructions for pushing a release tag and publishing its draft. The user performs all Git pushes.
---

# Podcast App Android release

The `Android release` workflow in `.github/workflows/android-release.yml` starts when the user pushes a new `vMAJOR.MINOR.PATCH` tag. It checks the tagged commit's package version, tests and bundles the app, signs and verifies the APK, and attaches the APK and checksum to a GitHub draft.

## Prepare locally

1. Confirm the working directory is the Podcast App repository. Check the branch, working tree, and existing local and remote tags. Prepare the release on an up-to-date `main` with the intended app changes. Preserve unrelated edits. For instructions-only requests, provide the applicable steps without changing the checkout.
2. Use the requested release version. For a new version bump, check that the tag is available, then run `npm version "$version" --no-git-tag-version` with the numeric version to update `package.json` and `package-lock.json`. In `android/app/build.gradle`, match `versionName` to the npm version and increment `versionCode` so it exceeds the code in the last distributed APK. If the release metadata is already prepared, verify it and reuse it.
3. Run `npm ci`, `npm test`, `npm run lint`, and `npm run build -- --mode android`. Confirm that `package.json`, the root version entries in `package-lock.json`, and Android's `versionName` match the intended tag without its `v` prefix. Report any failed or skipped checks before handing off a push.
4. When authorized, commit the release metadata using `chore(release): prepare Android vMAJOR.MINOR.PATCH` and create an annotated tag on that exact commit. Follow any applicable commit approval instructions. Use `git tag -a "$tag" "$release_commit" -m "Podcast Player $tag"` with the exact tag and commit. If the tag already points to the intended commit, reuse it. Check the versions in the tagged commit before handing it off.

## Hand off to the user

The user runs every Git push, including the branch push and the tag push. Provide the exact outstanding commands with the actual tag substituted. If both are pending, give `git push origin main` first and `git push origin <tag>` second. Identify the verified commit and tag. If local commit or tag creation is still pending, explain that status before giving the push commands.

After the tag is pushed, direct the user to **Actions → Android release**. The draft should contain `podcast-player-<version>.apk` and `podcast-player-<version>.apk.sha256`. Have the user verify the checksum, test the signed APK on a physical Android device, review the release notes, and select **Publish release**. For the device checklist, see **Build, verify, and publish a release** in the repository's `README.md`. Include an upgrade from the previous APK and check playback, saved library data, downloads, and Drive sync.

## Handle failures

- For a version mismatch on a pushed tag, inspect the version in that tag's commit. Prepare a corrected commit and a fresh version tag. Rerunning the old tag builds the same commit.
- For a signing error, use **Build an Android release on GitHub** in `README.md` to check setup for `ANDROID_KEYSTORE_BASE64` and `ANDROID_SIGNING_PROPERTIES`. Updates must use the existing release key. After resolving a runner or secret issue, the user can rerun the workflow for the same valid tag while the release is still a draft.
