# Changelog

## [0.1.19](https://github.com/opencadc/perfpulse/compare/v0.1.18...v0.1.19) (2026-06-18)


### Bug Fixes

* refresh Job status during completion polling ([#26](https://github.com/opencadc/perfpulse/issues/26)) ([0b16943](https://github.com/opencadc/perfpulse/commit/0b16943ca7d4ade0f7f1b0e0ea79815a0f0316aa))

## [0.1.18](https://github.com/opencadc/perfpulse/compare/v0.1.17...v0.1.18) (2026-06-18)


### Bug Fixes

* use zero-based k6 iteration for sequential benchmark surfaces ([#24](https://github.com/opencadc/perfpulse/issues/24)) ([befd561](https://github.com/opencadc/perfpulse/commit/befd561192f7fa0c660b836cdcd44a060397b9d6))

## [0.1.17](https://github.com/opencadc/perfpulse/compare/v0.1.16...v0.1.17) (2026-06-18)


### Features

* run cron and benchmark as single sequential TestRuns ([1dd08bb](https://github.com/opencadc/perfpulse/commit/1dd08bb192b4d2ce028a763c2f4e52679293dd5f))
* single sequential TestRun per cron tick and benchmark campaign ([b479c5f](https://github.com/opencadc/perfpulse/commit/b479c5fdf9eac7baed0341145f952eabb9236cac))

## [0.1.16](https://github.com/opencadc/perfpulse/compare/v0.1.15...v0.1.16) (2026-06-18)


### Features

* add cron gate backstops and per-testid OTLP service name ([93fdfa1](https://github.com/opencadc/perfpulse/commit/93fdfa190c0322d0e252c68face38844bb1747a8))

## [0.1.15](https://github.com/opencadc/perfpulse/compare/v0.1.14...v0.1.15) (2026-06-16)


### Features

* bulk Skaha stress lifecycle and jobs-per-VU cap ([86455f9](https://github.com/opencadc/perfpulse/commit/86455f9e5df2d3609770d7cd79c1fa56a41b7398))

## [0.1.14](https://github.com/opencadc/perfpulse/compare/v0.1.13...v0.1.14) (2026-06-16)


### Features

* Phase 2 simplification — unified lifecycle, Grafana split, fixed footprint ([#19](https://github.com/opencadc/perfpulse/issues/19)) ([23dc113](https://github.com/opencadc/perfpulse/commit/23dc113d7fa6b6710812cf7839cb27ad57be9e6c))


### Bug Fixes

* workload OOM, cron Grafana queries, and campaign scaling ([0fda475](https://github.com/opencadc/perfpulse/commit/0fda4753fb610c5a0f681858cff6447eba6b9141))

## [0.1.13](https://github.com/opencadc/perfpulse/compare/v0.1.12...v0.1.13) (2026-06-15)


### Bug Fixes

* **perfpulse:** lifecycle evidence and OTLP reliability (#CADC-15790) ([cf7a98b](https://github.com/opencadc/perfpulse/commit/cf7a98b3622325f2b696ba63efe4f9359f87243a))
* **perfpulse:** lifecycle evidence and OTLP reliability (#CADC-15790) ([e48e504](https://github.com/opencadc/perfpulse/commit/e48e5044ae408a7d147f58a4ae7246dda63d1eb5))
* **test:** include sleep in cleanup k6 mock for Bun 1.2.12 ([7752451](https://github.com/opencadc/perfpulse/commit/7752451af8647fa6f125540107f85223799cf37d))
* **test:** raise helm cron template test timeout for CI ([6e26916](https://github.com/opencadc/perfpulse/commit/6e269161a88a08394455dc9f68284917e7eb2f6d))
* **test:** satisfy LifecycleMetrics typecheck in metric spies ([580537f](https://github.com/opencadc/perfpulse/commit/580537fc61512a2a264cca7613ab63a5a7e750d7))
* **test:** stop k6/metrics mock leaking into runtime tests ([f6e7717](https://github.com/opencadc/perfpulse/commit/f6e7717933ae0e93a59b78cf8716ed4604a8fa5b))

## [0.1.12](https://github.com/opencadc/perfpulse/compare/v0.1.11...v0.1.12) (2026-05-11)


### Bug Fixes

* **perfpulse:** dashboards and metrics ([d9277ca](https://github.com/opencadc/perfpulse/commit/d9277ca98342d27a21038d78af085784cfe15dc6))

## [0.1.11](https://github.com/opencadc/perfpulse/compare/v0.1.10...v0.1.11) (2026-05-11)


### Features

* **perfpulse:** working metrics dashboard ([ee18b33](https://github.com/opencadc/perfpulse/commit/ee18b33fd2f78a7c73baf26ff9037d19d254f14d))

## [0.1.10](https://github.com/opencadc/perfpulse/compare/v0.1.9...v0.1.10) (2026-05-11)


### Bug Fixes

* **dockefile:** deps ([195bb47](https://github.com/opencadc/perfpulse/commit/195bb4791c70c39813ae48f87efe6bbaff634853))

## [0.1.9](https://github.com/opencadc/perfpulse/compare/v0.1.8...v0.1.9) (2026-05-11)


### Features

* **helm:** deployment for campaigns and cronjob ([5c0df37](https://github.com/opencadc/perfpulse/commit/5c0df3748a408d1a3684582f2c599fe25694a00a))


### Bug Fixes

* **testrun:** imporvement to metrics generated ([cab03c2](https://github.com/opencadc/perfpulse/commit/cab03c2566e46451d1a0ebead8f48aa6e4adb407))

## [0.1.8](https://github.com/opencadc/perfpulse/compare/v0.1.7...v0.1.8) (2026-05-07)


### Features

* add Helm CI/CD for PerfPulse ([1fbfe2a](https://github.com/opencadc/perfpulse/commit/1fbfe2a5ecab777d9a8aea512462c40dccc984b6))

## [0.1.7](https://github.com/opencadc/perfpulse/compare/v0.1.6...v0.1.7) (2026-05-06)


### Features

* **perfpulse:** add spot benchmark and stress TestRuns ([a9f14fb](https://github.com/opencadc/perfpulse/commit/a9f14fb822619fd5d414855fd8745e391beac02d))
* **perfpulse:** working skaha, k8s, kueue spot / benchmarks ([b242636](https://github.com/opencadc/perfpulse/commit/b242636b8619c8c5c30d1a13199f934e4dcfb7f4))

## [0.1.6](https://github.com/opencadc/perfpulse/compare/v0.1.5...v0.1.6) (2026-05-05)


### Features

* add kueue spot validation slice ([dcbaab3](https://github.com/opencadc/perfpulse/commit/dcbaab3a80ef11fb23996e0a4da7ce05d91100d5))

## [0.1.5](https://github.com/opencadc/perfpulse/compare/v0.1.4...v0.1.5) (2026-05-05)


### Features

* support artifact links in run evidence ([8356a9c](https://github.com/opencadc/perfpulse/commit/8356a9cfe333ce78172aea86cc6b55e7dabc1c3f))

## [0.1.4](https://github.com/opencadc/perfpulse/compare/v0.1.3...v0.1.4) (2026-05-05)


### Bug Fixes

* bind Grafana dashboard to prod metrics ([2c85ab9](https://github.com/opencadc/perfpulse/commit/2c85ab9244259f49197660e3a28dd0fbe15f19fe))

## [0.1.3](https://github.com/opencadc/perfpulse/compare/v0.1.2...v0.1.3) (2026-05-05)


### Bug Fixes

* keep Grafana run panels queryable ([8c497bb](https://github.com/opencadc/perfpulse/commit/8c497bbc78c7c406d66adf6b34723a68ae8039bb))

## [0.1.2](https://github.com/opencadc/perfpulse/compare/v0.1.1...v0.1.2) (2026-05-05)


### Bug Fixes

* satisfy prod restricted security policy ([48d0fa8](https://github.com/opencadc/perfpulse/commit/48d0fa82d4f1d8701e46a83497f0e720c306290e))

## [0.1.1](https://github.com/opencadc/perfpulse/compare/v0.1.0...v0.1.1) (2026-05-04)


### Features

* add otlp deployment contract ([09dbe65](https://github.com/opencadc/perfpulse/commit/09dbe65fda33b0e6f576ec640a5b0053362e9017))
* add perfpulse runtime surfaces ([d2d62b1](https://github.com/opencadc/perfpulse/commit/d2d62b1567717c51594db0fefaf43f9623e3c7f5))
* **perpulse:** added initial implementation of perfpulse ([848711b](https://github.com/opencadc/perfpulse/commit/848711bebceb69086fea0dea93d78279e072d75d))
* **smoke:** added a small kind cluster based local implementation to check is the system works as expected ([b6b8f25](https://github.com/opencadc/perfpulse/commit/b6b8f254fea90e8292cf94f5ae16f364003f7f00))
