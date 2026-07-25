import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import {
  countWeeklyReports,
  getLatestWeeklyReport,
  getWeeklyReportById,
  listWeeklyReports,
} from '@/data/report-store';
import { requireUser } from '@/lib/auth';
import { parsePageParams } from '@/lib/pagination';
import {
  buildLocalWeeklyReportExportPath,
  buildWeeklyReportExportFileName,
} from '@/lib/report-export';

export const reportsRouter = Router();

reportsRouter.get('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const page = parsePageParams(request.query);
    const [reports, total] = await Promise.all([
      listWeeklyReports(userId, page),
      countWeeklyReports(userId),
    ]);
    // Expose the unpaginated total so a client can page without the JSON shape changing.
    response.set('X-Total-Count', String(total));
    response.json({ reports });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/latest', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const report = await getLatestWeeklyReport(userId);

    if (!report) {
      response.status(404).json({ error: 'No weekly reports found' });
      return;
    }

    response.json({ report });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/:reportId/export', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    // Targeted lookup — previously this loaded the user's entire report history
    // and scanned it in JS just to render one export.
    const report = await getWeeklyReportById(userId, request.params.reportId);

    if (!report) {
      response.status(404).json({ error: 'Weekly report not found' });
      return;
    }

    const exportPath = buildLocalWeeklyReportExportPath(report);
    let markdown = report.reportMarkdown.endsWith('\n')
      ? report.reportMarkdown
      : `${report.reportMarkdown}\n`;

    try {
      markdown = await readFile(exportPath, 'utf8');
    } catch {
      // Fall back to the stored markdown if the local file has not been written yet.
    }

    response
      .type('text/markdown; charset=utf-8')
      .set('Content-Disposition', `inline; filename="${buildWeeklyReportExportFileName(report)}"`)
      .send(markdown);
  } catch (error) {
    next(error);
  }
});
