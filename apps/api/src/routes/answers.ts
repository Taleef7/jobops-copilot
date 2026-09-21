import { Router } from 'express';
import {
  deleteApplicationAnswer,
  listApplicationAnswers,
  upsertApplicationAnswer,
} from '@/data/application-answer-store';

export const answersRouter = Router();

answersRouter.get('/', async (request, response) => {
  const userId = request.userId;
  if (!userId) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const answers = await listApplicationAnswers(userId);
    return response.json({ answers });
  } catch (error) {
    console.error('Error listing application answers:', error);
    return response.status(500).json({ error: 'Failed to list application answers' });
  }
});

answersRouter.post('/', async (request, response) => {
  const userId = request.userId;
  if (!userId) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  const { questionText, answer, ats } = request.body || {};

  if (!questionText || typeof questionText !== 'string' || !questionText.trim()) {
    return response.status(400).json({ error: 'questionText is required and must be a non-empty string' });
  }

  if (typeof answer !== 'string') {
    return response.status(400).json({ error: 'answer is required and must be a string' });
  }

  try {
    const saved = await upsertApplicationAnswer(userId, {
      questionText: questionText.trim(),
      answer: answer.trim(),
      ats: typeof ats === 'string' && ats.trim() ? ats.trim() : undefined,
    });
    return response.status(201).json({ answer: saved });
  } catch (error) {
    console.error('Error saving application answer:', error);
    return response.status(500).json({ error: 'Failed to save application answer' });
  }
});

answersRouter.delete('/:id', async (request, response) => {
  const userId = request.userId;
  if (!userId) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const deleted = await deleteApplicationAnswer(userId, request.params.id);
    if (!deleted) {
      return response.status(404).json({ error: 'Application answer not found' });
    }
    return response.json({ success: true });
  } catch (error) {
    console.error('Error deleting application answer:', error);
    return response.status(500).json({ error: 'Failed to delete application answer' });
  }
});
