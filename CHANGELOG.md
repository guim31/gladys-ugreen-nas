# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-10-13

### Added

- Documentation in German (`docs/de.md`) and Spanish (`docs/es.md`), published
  by the store since Gladys 5.2.

### Changed

- Quieter logs: a normal read of the NAS writes nothing above the debug level
  (`LOG_LEVEL=debug` shows each read); a failure that repeats on every read
  (Gladys refusing states, `/data` not writable…) writes one line when it
  starts and one when it ends; each action of the user (save, search, test,
  widget refresh) writes one info line.

## [1.0.1] - 2026-10-13

### Added

- First version: monitors a UGREEN NASync running UGOS Pro over the local
  network, through the API of UGOS Pro (port 9999, RSA-encrypted login).
- The NAS as a device: online, CPU, memory, CPU temperature, download and
  upload rates, uptime, UGOS version.
- One device per volume (space used, capacity, free space, state, alert) and
  per disk (temperature, state, alert).
- Scene triggers: volume degraded, disk alert, NAS unreachable — on
  transitions only, remembered across restarts.
- Dashboard widget "UGREEN NAS": CPU, memory, temperature, volumes, problems
  first.
- "Test the connection" action.
- English, French, German and Spanish texts.

[Unreleased]: https://github.com/guim31/gladys-ugreen-nas/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-ugreen-nas/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-ugreen-nas/releases/tag/v1.0.1
