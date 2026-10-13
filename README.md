# UGREEN NAS for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that
monitors a **UGREEN NASync** running **UGOS Pro** over your local network:
CPU, memory, temperatures, network, volumes and disks, with scene triggers
when a volume or a disk needs attention and a dashboard widget.

> **Not affiliated with, endorsed by or sponsored by UGREEN.** UGREEN, NASync
> and UGOS are trademarks of their respective owners, named here only to
> describe compatibility.

> **Developed without the hardware: feedback welcome.** The UGOS Pro API is
> undocumented and no NAS was available while writing this integration: it
> follows what other open-source projects read on real hardware, and is
> tested against reconstructed answers. Reports from real NAS are the most
> useful contribution: [open an issue](https://github.com/guim31/gladys-ugreen-nas/issues).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

- **The NAS**: online, CPU and memory use, CPU temperature, download and
  upload rates, uptime, UGOS version.
- **One device per volume**: space used (%), capacity and free space (GB),
  state (healthy, warning, rebuilding, degraded, faulty — the worse of the
  volume and its storage pool) and an alert flag.
- **One device per disk**: temperature, state as UGOS rates it (healthy,
  warning, critical, failing…) and an alert flag.
- **Scene triggers**: _Volume degraded_, _Disk alert_, _NAS unreachable_ —
  fired on transitions only, remembered across restarts under `/data`.
- **Dashboard widget** _UGREEN NAS_: CPU and memory gauges, CPU temperature,
  the volumes and disks that need attention first, then every volume, the
  network and the uptime.
- **Read only.** Nothing is ever changed on the NAS: no shutdown, no restart,
  no file operation. A "Restart the NAS" button was left out on purpose.
- Feature names, states and messages in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A UGREEN NASync running UGOS Pro, reachable from Gladys on port **9999**.
- An account of the NAS without two-factor authentication, ideally dedicated
  to Gladys. If the volumes and disks stay missing with a standard user, that
  account needs to be an administrator.

## Installation

1. Install **UGREEN NAS** from the integration store of Gladys.
2. In its **Configuration** tab, enter the address of the NAS (e.g.
   `192.168.1.50`, port 9999 added), the user name and the password, then
   save.
3. Use **Test the connection** to check what was found.
4. Add the NAS, its volumes and its disks from the **Discover** tab.

## How it works

The integration logs in to the JSON API the UGOS Pro web interface uses, on
`http://<nas>:9999/ugreen/`:

1. `POST /ugreen/v1/verify/check` returns the RSA public key of the NAS in
   the `x-rsa-token` header;
2. the password is encrypted with it (RSA PKCS#1 v1.5) — it never travels in
   clear, even over plain HTTP — and sent to `POST /ugreen/v1/verify/login`,
   which returns a session token;
3. every minute (or 2 or 5), four read-only requests:
   `GET /ugreen/v1/sysinfo/machine/common`, `GET /ugreen/v1/taskmgr/stat/get_all`
   (`stat/overview` on firmwares without it), `GET /ugreen/v1/storage/pool/list`
   and `GET /ugreen/v2/storage/disk/list`. An expired session is reopened once.

**Why plain HTTP on 9999:** it is where UGOS Pro serves this API, and what the
other projects use. Over HTTPS (port 9443 or 443) the NAS presents a
self-signed certificate; an `https://` address works too, the certificate is
then accepted without verification. Either way the password is RSA-encrypted
by the protocol itself.

**What it never does:** call the SMART endpoints (`storage/disk/smart/...`),
which run `smartctl` and wake sleeping disks; retry a refused password on its
own (UGOS blocks an address after a few failed logins); write the password or
the session token in the logs or under `/data`
([`test/secrets.test.js`](test/secrets.test.js) checks it).

Devices are published with `should_poll: false`: the integration reads the
NAS on its own timer and sends only the values that changed (and every value
again after 6 hours).

## Checked, and what was not

Checked here: the login flow against a fake NAS doing real RSA decryption,
with the three key encodings UGOS was seen to send; the parsing of answers
**reconstructed** from the field names documented or parsed by the projects
below ([`test/fixtures/ugos/`](test/fixtures/ugos)); the conformity of every
device with the Gladys core ([`test/gladys-rules.test.js`](test/gladys-rules.test.js));
the widget against the validator of the SDK.

**Not checked on a real NAS:** the exact answers of a given firmware, the
units of the volume sizes (bytes assumed), the meaning of the network figures
of `stat/get_all` (one aggregate sample assumed), the state codes (taken from
the web interface as reported by other projects), the rights a standard
account has, and whether reading the disk list wakes sleeping disks.

## Limitations

- One NAS per installation.
- No two-factor authentication.
- UGOS (not Pro) of the older UGREEN NAS is not supported.
- Fans, GPU, UPS, Docker containers, virtual machines, shares and per-disk
  I/O are not read.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory NAS ([`test/helpers/fakeUgos.js`](test/helpers/fakeUgos.js)).
See [`CLAUDE.md`](CLAUDE.md) for the project rules.

### Releasing

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md),
then open **Actions → Release → Run workflow** and pick `patch`, `minor` or
`major`: the workflow bumps the version everywhere, moves the changelog
section, pushes the `vX.Y.Z` tag, builds the multi-arch image to `ghcr.io` and
publishes the GitHub Release.

> Prefer the terminal? `git tag v1.0.0 && git push --tags` triggers the same
> build and Release, but does **not** touch `package.json`, `CHANGELOG.md` or
> the manifest: bump `version` in `package.json` and in
> `gladys-assistant-integration.json` (with the `docker_image` tag) and commit
> it **before** tagging.

## Credits

- [Fracizz/ugnas-api](https://github.com/Fracizz/ugnas-api) (MIT): the
  reference for the login flow (RSA key in `x-rsa-token`, PKCS#1 v1.5, token
  in the query, code 1024 for an expired session) and the response envelope.
- [RCooLeR/UgosBridge](https://github.com/RCooLeR/UgosBridge) (MIT) by Roman
  Derevianko: the metrics worth reading on a UGOS NAS (CPU, memory, arrays and
  their degraded state, disk temperatures, network). It reads them on the NAS
  host itself; this integration reads them through the API instead.
- [metaneutrons/ugos-cli](https://github.com/metaneutrons/ugos-cli) (GPL-3.0)
  and [Tom-Bom-badil/home-assistant_ugreen-nas](https://github.com/Tom-Bom-badil/home-assistant_ugreen-nas)
  (GPL-3.0): **read only** to understand the endpoints, their field names and
  the state codes of the web interface. No code was copied from them.
- The architecture and the conformity tests follow
  [gladys-glances](https://github.com/guim31/gladys-glances), started from the
  official [integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by UGREEN or by any
of the projects above. Use it at your own risk; it only reads from the NAS.

## License

Apache-2.0
