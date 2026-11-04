export function SubmissionError({
  id,
  message,
}: {
  id: string;
  message: string;
}) {
  return (
    <p id={id} className="notice error submission-error" role="alert">
      {message}
    </p>
  );
}
