import { Request, Response, NextFunction } from 'express';
import { z }                              from 'zod';
import { SearchService }                  from './search.service';
import { AppError }                       from '../../shared/middleware/error-handler';
import { SearchEntityType }               from './search.types';

const querySchema = z.object({
  q:    z.string().min(2, 'Query must be at least 2 characters').max(100, 'Query too long'),
  type: z.nativeEnum(SearchEntityType).optional(),
});

const searchService = new SearchService();

export async function searchEntities(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(', ');
      throw new AppError(message, 400);
    }

    const { q, type } = parsed.data;
    const tenantId    = req.user!.tenantId as string;

    const result = await searchService.search(tenantId, q, type);

    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}
