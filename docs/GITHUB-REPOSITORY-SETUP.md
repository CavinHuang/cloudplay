# GitHub repository setup (CloudPlay v0.12)

## Target

- Repository: `CavinHuang/cloudplay` (preferred; rename freely)
- Visibility: **private** until third-party image licenses and hosted game rights have been reviewed.
- Default branch: `main`
- Do **not** initialize the remote with a README, .gitignore, or license, because this bundle already contains the project Git history.

## One-command bootstrap

Extract the CloudPlay GitHub bootstrap ZIP and run `bootstrap-cloudplay.ps1` (Windows with Git and authenticated GitHub CLI) or `bootstrap-cloudplay.sh` (macOS/Linux). These scripts clone the included Git bundle, create a *private* repository, and push `main`.

You can instead create a private empty repository at https://github.com/new and run the included `push-existing-cloudplay` script. No token or password should be placed in the project or shared with the assistant.

## GitHub Actions

- `.github/workflows/ci.yml`: unit tests and Next.js production build on pushes / PRs.
- `.github/workflows/cloudplay-upstream-build.yml`: manually triggered pinned Moonlight Web frontend compilation; **not a GPU stream test**.
- `.github/workflows/offline-windows-release.yml`: manually triggered Windows offline release build; **not yet verified in GitHub Actions**.

CI builds may fail on previously unverified platform dependencies; fix actual CI errors before enabling deployment or marking the project releasable. The current local environment cannot install Next.js dependencies.

## Security notes

- Keep local `.env`, `.env.local`, `.p0-lab-token`, journals, secrets, and generated release binaries **out of Git**.
- The `public/covers/demo` commercial-game covers are **design demonstration assets** and should not be redistributed publicly without permission.
- Do not expose the experimental game-launch API to the internet or attach an untrusted PR runner to the Windows GPU machine.
- CloudPlay v0.12 is not yet a validated playable game service. Video/audio/input require a physical Windows GPU test.
