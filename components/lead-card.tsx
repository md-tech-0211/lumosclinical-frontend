import { Lead } from '@/types/lead';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Building2, Briefcase, ChevronRight, Mail, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeadCardProps {
  lead: Lead;
  isSelected?: boolean;
  onClick: () => void;
  type?: 'lead' | 'deal';
}

function getInitials(lead: Lead, type: string): string {
  if (type === 'deal') {
    const name = lead.Deal_Name || '';
    return name.split(' ').map((w: string) => w[0]).filter(Boolean).join('').substring(0, 2).toUpperCase() || 'D';
  }
  const firstName = lead.First_Name || '';
  const lastName = lead.Last_Name || '';
  const company = lead.Company || '';
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (company) return company.substring(0, 2).toUpperCase();
  return 'L';
}

function getAvatarColor(lead: Lead): string {
  const colors = [
    'bg-primary/15 text-primary',
    'bg-green-100 text-green-700',
    'bg-blue-100 text-blue-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
  ];
  const hash = (lead.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export function LeadCard({ lead, isSelected, onClick, type = 'lead' }: LeadCardProps) {
  const initials = getInitials(lead, type);
  const colorClass = getAvatarColor(lead);
  const Icon = type === 'deal' ? Briefcase : Building2;

  // Different fields for leads vs deals
  const displayName = type === 'deal'
    ? (lead.Deal_Name || 'Untitled Deal')
    : (lead.Company || `${lead.First_Name || ''} ${lead.Last_Name || ''}`.trim() || 'Unknown Lead');

  const subtitle = type === 'deal'
    ? (lead.Owner?.name || lead.Contact_Name?.name || null)
    : (lead.First_Name || lead.Last_Name ? `${lead.First_Name || ''} ${lead.Last_Name || ''}`.trim() : null);

  const status = type === 'deal' ? lead.Stage : lead.Lead_Status;

  const detail = type === 'deal'
    ? (lead.Account_Name?.name || null)
    : (lead.Email || null);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors hover:bg-accent',
        isSelected && 'bg-accent'
      )}
    >
      <Avatar className={cn('h-10 w-10 flex-shrink-0', colorClass)}>
        <AvatarFallback className={colorClass}>
          {initials}
        </AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 mb-1">
          <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="font-medium text-sm truncate">{displayName}</span>
        </div>

        {status && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 mb-1 max-w-full truncate inline-block">
            {status}
          </Badge>
        )}
        
        {subtitle && (
          <p className="text-sm text-muted-foreground truncate mb-0.5">
            {type === 'deal' ? <User className="h-3 w-3 inline mr-1" /> : null}
            {subtitle}
          </p>
        )}
        
        {detail && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{detail}</span>
          </div>
        )}
      </div>
      
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-2" />
    </button>
  );
}
