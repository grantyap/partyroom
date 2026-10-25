# Agent instructions

## GitHub issues

- When creating or substantially rewriting an issue, read and use the appropriate
  template in [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE):
  [bug report](.github/ISSUE_TEMPLATE/bug_report.md) or
  [implementation task](.github/ISSUE_TEMPLATE/implementation_task.md).
- This applies to `gh`, API calls, and delegated work. When supplying a body with
  `--body-file` or an API, fill the template's Markdown sections explicitly;
  GitHub does not enforce the template on these paths. Omit YAML frontmatter and
  replace the instructional comments with concrete details.
- Keep each issue focused on one outcome. Use a descriptive title, observable
  acceptance criteria, relevant code pointers, and specific validation steps.
  Distinguish reproduced bugs from suspected failures; label unknowns explicitly.
  Remove optional sections that do not apply. Never include secrets or customer data.
- For larger work, use a parent issue with focused sub-issues. Record actual
  prerequisites as GitHub blocking relationships and summarize them in the body.
- Before implementing an issue, read its dependencies and confirm its baseline
  branch/commit is present. Link the resulting PR and report validation evidence.

The templates adapt GitHub's [issue-writing checklist](https://github.blog/developer-skills/github/how-to-create-issues-and-pull-requests-in-record-time-on-github/#the-anatomy-of-a-great-github-issue)
and [issue manager guidance](https://docs.github.com/en/copilot/tutorials/customization-library/custom-instructions/issue-manager).
