'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Sparkles, Save, Trash2, GripVertical, Briefcase, GraduationCap, Wrench, FolderKanban, Award } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { saveBaseResume, parseResumeToStructured } from '@/lib/api';
import type {
  StructuredResume,
  ResumeWorkExperience,
  ResumeEducation,
  ResumeSkill,
  ResumeProject,
  ResumeCertificate,
} from '@/types/job';

interface BaseResumeEditorProps {
  initial: StructuredResume | null;
  hasStoredResume: boolean;
}

function emptyResume(): StructuredResume {
  return {
    basics: { name: '', email: '', summary: '' },
    work: [],
    education: [],
    skills: [],
    projects: [],
    certificates: [],
  };
}

function emptyWork(): ResumeWorkExperience {
  return { company: '', position: '', startDate: '', highlights: [] };
}

function emptyEducation(): ResumeEducation {
  return { institution: '', area: '', studyType: '' };
}

function emptySkill(): ResumeSkill {
  return { category: '', skills: [] };
}

function emptyProject(): ResumeProject {
  return { name: '', description: '' };
}

function emptyCertificate(): ResumeCertificate {
  return { name: '', issuer: '' };
}

export function BaseResumeEditor({ initial, hasStoredResume }: BaseResumeEditorProps) {
  const router = useRouter();
  const [resume, setResume] = useState<StructuredResume>(initial ?? emptyResume());
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const hasContent = Boolean(resume.basics.name);

  const updateBasics = useCallback(
    (field: string, value: string) => {
      setResume((prev) => ({ ...prev, basics: { ...prev.basics, [field]: value } }));
    },
    [],
  );

  // --- Work experience ---
  const addWork = () => setResume((prev) => ({ ...prev, work: [...prev.work, emptyWork()] }));
  const removeWork = (index: number) =>
    setResume((prev) => ({ ...prev, work: prev.work.filter((_, i) => i !== index) }));
  const updateWork = (index: number, field: string, value: unknown) =>
    setResume((prev) => ({
      ...prev,
      work: prev.work.map((w, i) => (i === index ? { ...w, [field]: value } : w)),
    }));

  // --- Education ---
  const addEducation = () =>
    setResume((prev) => ({ ...prev, education: [...prev.education, emptyEducation()] }));
  const removeEducation = (index: number) =>
    setResume((prev) => ({ ...prev, education: prev.education.filter((_, i) => i !== index) }));
  const updateEducation = (index: number, field: string, value: string) =>
    setResume((prev) => ({
      ...prev,
      education: prev.education.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    }));

  // --- Skills ---
  const addSkillCategory = () =>
    setResume((prev) => ({ ...prev, skills: [...prev.skills, emptySkill()] }));
  const removeSkillCategory = (index: number) =>
    setResume((prev) => ({ ...prev, skills: prev.skills.filter((_, i) => i !== index) }));
  const updateSkillCategory = (index: number, field: string, value: unknown) =>
    setResume((prev) => ({
      ...prev,
      skills: prev.skills.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }));

  // --- Projects ---
  const addProject = () =>
    setResume((prev) => ({
      ...prev,
      projects: [...(prev.projects ?? []), emptyProject()],
    }));
  const removeProject = (index: number) =>
    setResume((prev) => ({
      ...prev,
      projects: (prev.projects ?? []).filter((_, i) => i !== index),
    }));
  const updateProject = (index: number, field: string, value: string) =>
    setResume((prev) => ({
      ...prev,
      projects: (prev.projects ?? []).map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    }));

  // --- Certificates ---
  const addCertificate = () =>
    setResume((prev) => ({
      ...prev,
      certificates: [...(prev.certificates ?? []), emptyCertificate()],
    }));
  const removeCertificate = (index: number) =>
    setResume((prev) => ({
      ...prev,
      certificates: (prev.certificates ?? []).filter((_, i) => i !== index),
    }));
  const updateCertificate = (index: number, field: string, value: string) =>
    setResume((prev) => ({
      ...prev,
      certificates: (prev.certificates ?? []).map((c, i) =>
        i === index ? { ...c, [field]: value } : c,
      ),
    }));

  // --- Import from stored resume ---
  async function handleImportFromResume() {
    setParsing(true);
    try {
      const parsed = await parseResumeToStructured();
      setResume(parsed);
      toast.success('Resume parsed into structured form. Review and save when ready.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to parse resume. Try again.',
      );
    } finally {
      setParsing(false);
    }
  }

  // --- Save ---
  async function handleSave() {
    if (!resume.basics.name.trim()) {
      toast.error('Name is required in the Basics section.');
      return;
    }
    setSaving(true);
    try {
      await saveBaseResume(resume);
      toast.success('Base resume saved successfully.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="base-resume-editor">
      {/* Import action */}
      {hasStoredResume && !hasContent ? (
        <div className="bg-primary/5 border-primary/20 flex items-center gap-3 rounded-lg border p-4">
          <Sparkles className="text-primary size-5 shrink-0" />
          <div className="mr-auto space-y-0.5">
            <p className="text-sm font-medium">Import from your uploaded resume</p>
            <p className="text-muted-foreground text-xs">
              AI will extract your resume into a structured format you can review and edit.
            </p>
          </div>
          <Button size="sm" disabled={parsing} onClick={() => void handleImportFromResume()}>
            {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {parsing ? 'Parsing…' : 'Import'}
          </Button>
        </div>
      ) : null}

      {/* Basics */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Basics</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="br-name">Full name *</Label>
            <Input
              id="br-name"
              value={resume.basics.name}
              onChange={(e) => updateBasics('name', e.target.value)}
              placeholder="Jane Doe"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="br-label">Title / label</Label>
            <Input
              id="br-label"
              value={resume.basics.label ?? ''}
              onChange={(e) => updateBasics('label', e.target.value)}
              placeholder="Senior Software Engineer"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="br-email">Email *</Label>
            <Input
              id="br-email"
              type="email"
              value={resume.basics.email}
              onChange={(e) => updateBasics('email', e.target.value)}
              placeholder="jane@example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="br-phone">Phone</Label>
            <Input
              id="br-phone"
              value={resume.basics.phone ?? ''}
              onChange={(e) => updateBasics('phone', e.target.value)}
              placeholder="+1-555-0100"
            />
          </div>
          <div className="col-span-full space-y-1">
            <Label htmlFor="br-summary">Professional summary</Label>
            <Textarea
              id="br-summary"
              rows={3}
              value={resume.basics.summary}
              onChange={(e) => updateBasics('summary', e.target.value)}
              placeholder="A brief summary of your experience and goals…"
            />
          </div>
        </div>
      </section>

      {/* Work Experience */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Briefcase className="size-4" /> Work Experience
            <Badge variant="secondary" className="ml-1">{resume.work.length}</Badge>
          </h3>
          <Button variant="outline" size="sm" onClick={addWork}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {resume.work.map((w, i) => (
          <Card key={i} className="relative space-y-3 p-4">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7"
              onClick={() => removeWork(i)}
              aria-label="Remove work experience"
            >
              <Trash2 className="size-3.5" />
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Company</Label>
                <Input
                  value={w.company}
                  onChange={(e) => updateWork(i, 'company', e.target.value)}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-1">
                <Label>Position</Label>
                <Input
                  value={w.position}
                  onChange={(e) => updateWork(i, 'position', e.target.value)}
                  placeholder="Senior Engineer"
                />
              </div>
              <div className="space-y-1">
                <Label>Start date</Label>
                <Input
                  value={w.startDate}
                  onChange={(e) => updateWork(i, 'startDate', e.target.value)}
                  placeholder="2020-01-01"
                />
              </div>
              <div className="space-y-1">
                <Label>End date</Label>
                <Input
                  value={w.endDate ?? ''}
                  onChange={(e) => updateWork(i, 'endDate', e.target.value)}
                  placeholder="Present or 2024-06-01"
                />
              </div>
              <div className="space-y-1">
                <Label>Location</Label>
                <Input
                  value={w.location ?? ''}
                  onChange={(e) => updateWork(i, 'location', e.target.value)}
                  placeholder="San Francisco, CA"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Highlights (one per line)</Label>
              <Textarea
                rows={3}
                value={w.highlights.join('\n')}
                onChange={(e) =>
                  updateWork(i, 'highlights', e.target.value.split('\n').filter(Boolean))
                }
                placeholder="Led migration to microservices&#10;Reduced latency by 40%"
              />
            </div>
          </Card>
        ))}
      </section>

      {/* Education */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <GraduationCap className="size-4" /> Education
            <Badge variant="secondary" className="ml-1">{resume.education.length}</Badge>
          </h3>
          <Button variant="outline" size="sm" onClick={addEducation}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {resume.education.map((ed, i) => (
          <Card key={i} className="relative space-y-3 p-4">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7"
              onClick={() => removeEducation(i)}
              aria-label="Remove education"
            >
              <Trash2 className="size-3.5" />
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Institution</Label>
                <Input
                  value={ed.institution}
                  onChange={(e) => updateEducation(i, 'institution', e.target.value)}
                  placeholder="MIT"
                />
              </div>
              <div className="space-y-1">
                <Label>Area / major</Label>
                <Input
                  value={ed.area ?? ''}
                  onChange={(e) => updateEducation(i, 'area', e.target.value)}
                  placeholder="Computer Science"
                />
              </div>
              <div className="space-y-1">
                <Label>Degree type</Label>
                <Input
                  value={ed.studyType ?? ''}
                  onChange={(e) => updateEducation(i, 'studyType', e.target.value)}
                  placeholder="BS, MS, PhD"
                />
              </div>
              <div className="space-y-1">
                <Label>End date</Label>
                <Input
                  value={ed.endDate ?? ''}
                  onChange={(e) => updateEducation(i, 'endDate', e.target.value)}
                  placeholder="2016-05-15"
                />
              </div>
            </div>
          </Card>
        ))}
      </section>

      {/* Skills */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Wrench className="size-4" /> Skills
            <Badge variant="secondary" className="ml-1">{resume.skills.length}</Badge>
          </h3>
          <Button variant="outline" size="sm" onClick={addSkillCategory}>
            <Plus className="size-3.5" /> Add category
          </Button>
        </div>
        {resume.skills.map((s, i) => (
          <Card key={i} className="relative space-y-2 p-4">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7"
              onClick={() => removeSkillCategory(i)}
              aria-label="Remove skill category"
            >
              <Trash2 className="size-3.5" />
            </Button>
            <div className="space-y-1">
              <Label>Category</Label>
              <Input
                value={s.category}
                onChange={(e) => updateSkillCategory(i, 'category', e.target.value)}
                placeholder="Programming Languages"
              />
            </div>
            <div className="space-y-1">
              <Label>Skills (comma-separated)</Label>
              <Input
                value={s.skills.join(', ')}
                onChange={(e) =>
                  updateSkillCategory(
                    i,
                    'skills',
                    e.target.value
                      .split(',')
                      .map((sk) => sk.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="TypeScript, Python, Go"
              />
            </div>
          </Card>
        ))}
      </section>

      {/* Projects */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <FolderKanban className="size-4" /> Projects
            <Badge variant="secondary" className="ml-1">{(resume.projects ?? []).length}</Badge>
          </h3>
          <Button variant="outline" size="sm" onClick={addProject}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {(resume.projects ?? []).map((p, i) => (
          <Card key={i} className="relative space-y-2 p-4">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7"
              onClick={() => removeProject(i)}
              aria-label="Remove project"
            >
              <Trash2 className="size-3.5" />
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={p.name}
                  onChange={(e) => updateProject(i, 'name', e.target.value)}
                  placeholder="JobOps Copilot"
                />
              </div>
              <div className="space-y-1">
                <Label>URL</Label>
                <Input
                  value={p.url ?? ''}
                  onChange={(e) => updateProject(i, 'url', e.target.value)}
                  placeholder="https://github.com/…"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={p.description ?? ''}
                onChange={(e) => updateProject(i, 'description', e.target.value)}
                placeholder="Brief project description…"
              />
            </div>
          </Card>
        ))}
      </section>

      {/* Certificates */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Award className="size-4" /> Certificates
            <Badge variant="secondary" className="ml-1">
              {(resume.certificates ?? []).length}
            </Badge>
          </h3>
          <Button variant="outline" size="sm" onClick={addCertificate}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {(resume.certificates ?? []).map((c, i) => (
          <Card key={i} className="relative space-y-2 p-4">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7"
              onClick={() => removeCertificate(i)}
              aria-label="Remove certificate"
            >
              <Trash2 className="size-3.5" />
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={c.name}
                  onChange={(e) => updateCertificate(i, 'name', e.target.value)}
                  placeholder="AWS Solutions Architect"
                />
              </div>
              <div className="space-y-1">
                <Label>Issuer</Label>
                <Input
                  value={c.issuer}
                  onChange={(e) => updateCertificate(i, 'issuer', e.target.value)}
                  placeholder="Amazon Web Services"
                />
              </div>
            </div>
          </Card>
        ))}
      </section>

      {/* Save bar */}
      <div className="bg-background sticky bottom-0 flex items-center justify-between gap-3 border-t pt-4 pb-2">
        {hasStoredResume && hasContent ? (
          <Button
            variant="outline"
            size="sm"
            disabled={parsing}
            onClick={() => void handleImportFromResume()}
          >
            {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Re-import from resume
          </Button>
        ) : (
          <div />
        )}
        <Button size="sm" disabled={saving || !resume.basics.name.trim()} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? 'Saving…' : 'Save base resume'}
        </Button>
      </div>
    </div>
  );
}
