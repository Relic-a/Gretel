// Categories describe the observed boundary, not words in an error message.
const categories = new Map([
 ['native.adapter','platform'], ['soak-storage-updater-temp-budget','platform'],
 ['chaos.diagnostics.bundle','product-capability'],
 ...['chaos.process-kill.before-commit','chaos.database.enospc','chaos.browser.feed-preservation','soak-refresh-fixture','soak-feed-work-drained','soak-storage-runner','soak-soak-runner','soak-report-schema','soak-report-completeness','soak-report-missing','soak-owned-lifecycle','soak-runner-cancelled','soak-cancelled','soak-storage-skipped','soak-wall-clock-skipped','e2e.runner','e2e.mode'].map(id=>[id,'tooling']),
 ...['soak-idle-cpu','soak-idle-rss-stability','soak-rss-trend'].map(id=>[id,'resource-qualification']),
 ['e2e.prerequisites','platform'],
]);
export function categorizeCase(c) { return {...c, category:c.category || categories.get(c.id) || 'product'}; }
