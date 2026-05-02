# Issue tracker: Jira

Issues and PRDs for this repo live in Jira project `CADC`. Use the attached Atlassian Rovo MCP tools for Jira operations.

## Project and assignee

- Use Jira project key `CADC` unless the user request explicitly names another Jira project.
- Assign created issues to Shiny Brar:
  - Atlassian account id: `712020:7f55303d-731e-4d72-b480-9d4d77a424b5`
  - Email: `charanjot.brar@nrc-cnrc.gc.ca`
- If the user names a different assignee for a specific issue, follow that specific instruction.

## Issue structure

- A PRD maps to one Jira `Story` in project `CADC`.
- Actual implementation tasks under that PRD should be Jira `Sub-Task` issues with the Story as their `parent`.
- Do not create separate top-level `Task` issues for PRD task breakdowns unless the user explicitly asks for that.
- Avoid creating `Epic` issues for PRDs unless the user explicitly asks for an Epic.

## Conventions

- Search existing work with Jira search before creating duplicates.
- Create PRD parent work with `createJiraIssue` using `issueTypeName: "Story"`, `projectKey: "CADC"`, and `assignee_account_id` set to Shiny Brar's account id.
- Create implementation tasks with `createJiraIssue` using `issueTypeName: "Sub-Task"` and `parent` set to the parent Story key.
- Read existing tickets with `getJiraIssue`.
- Comment on tickets with `addCommentToJiraIssue`.
- Transition tickets with `transitionJiraIssue` after checking available transitions.
- Check available transitions with `getTransitionsForJiraIssue`; transition names and availability can vary by current status.

## When a skill says "publish to the issue tracker"

Create a Jira `Story` in project `CADC` using Atlassian Rovo MCP, assign it to Shiny Brar, and create child `Sub-Task` issues for the actionable task breakdown when the skill has task-level detail.

## When a skill says "fetch the relevant ticket"

Fetch the Jira issue by key, including comments when needed for context.
