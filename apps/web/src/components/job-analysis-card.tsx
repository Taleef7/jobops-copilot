import { SkillChipList } from '@/components/skill-chip';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { confidenceLabel, signalLabel } from '@/lib/analysis-display';
import { cn } from '@/lib/utils';
import type { JobAnalysis } from '@/types/job';

/**
 * A job's fit read on the Analysis tab. A signal nothing measured says "unknown", and skills
 * are short labels with their evidence on hover and focus (#354).
 */
export function JobAnalysisCard({ analysis }: { analysis: JobAnalysis }) {
  const confidence = confidenceLabel(analysis.confidenceScore);
  const signals = analysis.subSignals
    ? [
        { label: 'Skills Match', value: analysis.subSignals.skillsMatch },
        { label: 'Title & Seniority', value: analysis.subSignals.titleSeniority },
        { label: 'Salary Fit', value: analysis.subSignals.salaryFit },
        { label: 'Sponsorship', value: analysis.subSignals.sponsorshipLikelihood },
      ]
    : null;

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap gap-2">
        {confidence ? <Badge variant="secondary">{confidence}</Badge> : null}
        <Badge variant="secondary">Model: {analysis.modelUsed}</Badge>
      </div>
      {signals && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            Match Signals
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {signals.map(({ label, value }) => (
              <div key={label} className="bg-muted/40 rounded-lg p-2.5 text-center">
                <p className="text-muted-foreground text-xs">{label}</p>
                <p
                  className={cn(
                    'font-heading text-base font-semibold',
                    value == null && 'text-muted-foreground font-normal',
                  )}
                >
                  {signalLabel(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
          Fit summary
        </p>
        <p className="text-sm leading-relaxed">{analysis.fitSummary}</p>
      </div>
      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
          Recommended resume angle
        </p>
        <p className="text-sm leading-relaxed">{analysis.recommendedResumeAngle}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Matched skills
          </p>
          <SkillChipList
            items={analysis.matchedSkills.map(({ skill, evidence }) => ({ label: skill, detail: evidence }))}
            variant="matched"
            empty="None matched yet."
          />
        </div>
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Missing skills
          </p>
          <SkillChipList
            items={analysis.missingSkills.map(({ skill, postingQuote }) => ({ label: skill, detail: postingQuote }))}
            variant="missing"
            empty="None missing."
          />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          ATS keywords
        </p>
        <SkillChipList items={analysis.atsKeywords} empty="Not parsed yet." />
      </div>
      <div className="bg-muted/40 rounded-lg p-3">
        <p className="text-muted-foreground mb-0.5 text-xs">Apply recommendation</p>
        <p className="text-sm">{analysis.applyRecommendation}</p>
      </div>
    </Card>
  );
}
