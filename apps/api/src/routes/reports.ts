import { Router } from 'express';
import { getLatestWeeklyReport, listWeeklyReports } from '@/data/report-store';

export const reportsRouter = Router();

reportsRouter.get('/', async (_request, response, next) => {
  try {
    const reports = await listWeeklyReports();
    response.json({ reports });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/latest', async (_request, response, next) => {
  try {
    const report = await getLatestWeeklyReport();

    if (!report) {
      response.status(404).json({ error: 'No weekly reports found' });
      return;
    }

    response.json({ report });
  } catch (error) {
    next(error);
  }
});
