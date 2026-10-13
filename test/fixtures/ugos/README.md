# UGOS Pro fixtures

Answers of the UGOS Pro JSON API, **reconstructed** for the tests: no capture
of a real NAS was available. The shapes and field names follow what the
projects that read this API on real hardware document or parse:

- `Fracizz/ugnas-api` (MIT): the login flow, the `{ code, msg, data }`
  envelope, `data.result` lists;
- `RCooLeR/UgosBridge` (MIT) documentation: the metrics a UGOS NAS exposes;
- `metaneutrons/ugos-cli` and `Tom-Bom-badil/home-assistant_ugreen-nas`
  (GPL-3.0, read only, nothing copied): the paths and the field names of
  `sysinfo/machine/common`, `taskmgr/stat/*`, `storage/pool/list` and
  `v2/storage/disk/list`, and the state codes of the web interface.

Every identifier is fake: serial numbers (`UGTEST…`, `WD-TESTDISK…`,
`S6TESTNVME…`), a locally administered MAC address (`02:…`) and an address of
the documentation range (`192.0.2.0/24`, RFC 5737).

| File                  | Endpoint                                |
| --------------------- | --------------------------------------- |
| `machine-common.json` | `GET /ugreen/v1/sysinfo/machine/common` |
| `stat-get_all.json`   | `GET /ugreen/v1/taskmgr/stat/get_all`   |
| `pool-list.json`      | `GET /ugreen/v1/storage/pool/list`      |
| `disk-list.json`      | `GET /ugreen/v2/storage/disk/list`      |

A capture from a real NAS, anonymized, is welcome: open an issue.
