import { UserCircle2 } from 'lucide-react';

export function LeadEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="mb-4 text-muted-foreground">
        <UserCircle2 className="h-24 w-24 mx-auto opacity-20" strokeWidth={1} />
      </div>
      <h2 className="text-2xl font-semibold mb-2 text-balance">Select a Lead</h2>
      <p className="text-muted-foreground max-w-md leading-relaxed text-balance">
        Choose a lead from the list on the left to view their details,
        qualification status, and marketing materials.
      </p>
    </div>
  );
}
