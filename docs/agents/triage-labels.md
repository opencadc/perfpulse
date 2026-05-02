# Triage State

The skills speak in terms of five canonical triage roles, but this Jira project tracks work state with Jira workflow statuses rather than dedicated triage labels. Do not create or apply synthetic labels such as `needs-triage`, `ready-for-agent`, or `wontfix` unless the user explicitly asks.

Checked against the `CADC` Jira project through Atlassian Rovo MCP on 2026-05-01. Observed workflow statuses include `To Do`, `In Progress`, `On Hold`, `Review`, and `Done`.

## Status Mapping

| Skill role        | Jira status | Meaning                                                           |
| ----------------- | ----------- | ----------------------------------------------------------------- |
| `needs-triage`    | `To Do`     | Newly captured work that still needs maintainer evaluation         |
| `needs-info`      | `On Hold`   | Waiting for more information, a blocker, or an external decision   |
| `ready-for-agent` | `To Do`     | Fully specified and ready for an agent to pick up                  |
| `ready-for-human` | `Review`    | Ready for human review, decision, or follow-up                     |
| `wontfix`         | `Done`      | Will not be actioned; add a comment explaining the closeout reason |

`ready-for-agent` is a readiness distinction rather than a separate Jira state in this project. Preserve that distinction in the issue description or comments when needed.

## Workflow Statuses

- `To Do`: created, ready, or awaiting prioritization.
- `In Progress`: actively being worked.
- `On Hold`: blocked or waiting for information.
- `Review`: implementation is ready for review.
- `Done`: complete or explicitly closed out.

Before changing status, call `getTransitionsForJiraIssue` and use the transition Jira exposes from the issue's current state.

## Assignee Rule

Created issues should be assigned to Shiny Brar unless the user explicitly names someone else:

- Account id: `712020:7f55303d-731e-4d72-b480-9d4d77a424b5`
- Email: `charanjot.brar@nrc-cnrc.gc.ca`

## Observed CADC Jira Labels

The `CADC` Jira project uses labels mostly for domains, facilities, initiatives, and work streams rather than triage state. Observed labels include:

`AccessControl`, `AdvancedSearch`, `ALMA`, `arbutus-refresh`, `beta-global-site`, `beta-uvic-site`, `bug`, `C3TP`, `CADC`, `cadc-west-01`, `CANFAR`, `CAOM`, `CIRADA`, `CLF`, `Clients`, `cli`, `CVO`, `DevOps`, `Development-Work-in-Progress`, `Documentation`, `DOI`, `DRAO`, `enhancement`, `EPIC-JWST`, `Epic-HST-Pipe`, `epic-storage-alpha`, `EPIC-STORAGE-BETA`, `gamma`, `GDPR`, `Gemini`, `GMUI`, `IVOA`, `jupyter`, `LDAP`, `LGTM`, `LSST`, `NEP-110`, `OBSERVABILITY`, `OLA`, `Operations`, `Processing`, `Python-TAP-Client`, `Rebuild`, `research`, `RUBIN`, `SciencePlatform`, `Services`, `SKA`, `SKA-SDP`, `SRC-National`, `SRCNet`, `Storage`, `SustainingFunding`, `TAP`, `UI`, `UVICRCS`, `VOS`, `VOSpace`, `VOSpaceBrowser`, `youcat`.

If the team later creates dedicated Jira labels or statuses for triage state, update the mapping table above.
