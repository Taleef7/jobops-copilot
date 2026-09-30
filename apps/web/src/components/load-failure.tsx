import { ErrorState } from '@/components/error-state';

type LoadFailureProps = {
  /** The page's own heading, so the page still says where you are. */
  heading: string;
  /** What didn't load, e.g. "Couldn't load your jobs". */
  title: string;
  /** Why, from the loader. */
  message: string;
};

/**
 * What a page shows when its data couldn't be loaded (#349): the page heading, the reason,
 * and "Try again". It used to show a local sample dataset under a "Seed data shown" note.
 */
export function LoadFailure({ heading, title, message }: LoadFailureProps) {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">{heading}</h1>
      <ErrorState title={title} message={message} />
    </div>
  );
}
