const labels = {
  draft: 'Draft',
  prReview: 'PR Review',
  needsSecondReview: 'Needs 2nd Review',
};

async function getCurrentLabel(github, owner, repo, issue_number) {
  const { data: currentLabelsData } = await github.rest.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number,
  });
  return currentLabelsData
    .map(label => label.name)
    .find(name => Object.values(labels).includes(name));
}

async function determineTargetLabel(github, pr, owner, repo, issue_number) {
  if (pr.draft) {
    return labels.draft;
  }
  
  const { data: reviews } = await github.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: issue_number,
  });

  const approvedReviewers = new Set(
    reviews
      .filter(review => review.state === 'APPROVED')
      .map(review => review.user.login)
  );

  if (approvedReviewers.size === 0) {
    return labels.prReview;
  }
  
  const lastApprovedReview = [...reviews]
    .filter(review => review.state === 'APPROVED')
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
  
  const lastApprovalDate = new Date(lastApprovedReview.submitted_at);

  const commits = await github.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: issue_number,
  });
  const lastCommitDate = new Date(commits.data[commits.data.length - 1].commit.committer.date);

  return lastCommitDate > lastApprovalDate ? labels.prReview : labels.needsSecondReview;
}

async function updateLabel(github, owner, repo, issue_number, currentLabel, targetLabel) {
  if (currentLabel !== targetLabel) {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number,
      labels: [targetLabel],
    });

    if (currentLabel) {
      try {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number,
          name: currentLabel,
        });
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }
  }
}

module.exports = async ({ github, context }) => {
  const pr = context.payload.pull_request;
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issue_number = pr.number;

  const currentLabel = await getCurrentLabel(github, owner, repo, issue_number);
  const targetLabel = await determineTargetLabel(github, pr, owner, repo, issue_number);
  await updateLabel(github, owner, repo, issue_number, currentLabel, targetLabel);
};
