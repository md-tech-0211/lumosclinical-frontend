'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { LeadDetailResponse } from '@/types/lead';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Building2, 
  Mail, 
  Phone, 
  Globe, 
  Layers, 
  Lightbulb, 
  MessageCircleQuestion, 
  FileText,
  ExternalLink,
  Target,
  RefreshCw,
  InfoIcon,
  PhoneCall,
  PhoneOff,
  Clock,
  Calendar,
  ChevronDown,
  ChevronUp,
  Copy,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeadDetailsProps {
  leadDetail: LeadDetailResponse;
  onReevaluate?: () => void;
  isReevaluating?: boolean;
}

function getInitials(leadDetail: LeadDetailResponse): string {
  const lead = leadDetail.data;
  const firstName = lead.First_Name || '';
  const lastName = lead.Last_Name || '';
  const company = lead.Company || '';

  if (firstName && lastName) {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  }
  if (company) {
    return company.substring(0, 2).toUpperCase();
  }
  return 'L';
}

function getAvatarColor(leadDetail: LeadDetailResponse): string {
  const colors = [
    'bg-teal-500 text-white',
    'bg-green-500 text-white',
    'bg-blue-500 text-white',
    'bg-amber-500 text-white',
    'bg-rose-500 text-white',
    'bg-purple-500 text-white',
    'bg-cyan-500 text-white',
  ];
  
  const hash = (leadDetail.data.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getFitScoreColor(score?: number): string {
  if (!score) return 'bg-muted text-muted-foreground';
  if (score >= 8) return 'bg-green-100 text-green-700';
  if (score >= 6) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

function getFitScoreLabel(score?: number): string {
  if (!score) return 'Not Assessed';
  if (score >= 8) return 'Strong Fit';
  if (score >= 6) return 'Moderate Fit';
  return 'Weak Fit';
}

function getConfidenceBadgeVariant(confidence?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const level = confidence?.toLowerCase();
  if (level === 'high') return 'default';
  if (level === 'medium') return 'secondary';
  return 'outline';
}

export function LeadDetails({ leadDetail, onReevaluate, isReevaluating }: LeadDetailsProps) {
  const { data: lead, analysis, marketing_materials, similar_customers, meetings } = leadDetail;
  const initials = getInitials(leadDetail);
  const colorClass = getAvatarColor(leadDetail);
  const [isMeetingExpanded, setIsMeetingExpanded] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  const copyToClipboard = async (text: string, type: 'email' | 'phone') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'email') {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
      } else {
        setCopiedPhone(true);
        setTimeout(() => setCopiedPhone(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  // Check if this is a deal or lead
  const isDeal = !!lead.Deal_Name;
  
  // Get display name (deals show Deal_Name, leads show person name)
  const displayName = isDeal
    ? (lead.Deal_Name || 'Untitled Deal')
    : (`${lead.First_Name || ''} ${lead.Last_Name || ''}`.trim() || 'Unknown Contact');
  
  // Get company name
  const companyName = isDeal
    ? (lead.Account_Name?.name || lead.Company || 'No Company')
    : (lead.Company || null);
  
  // Get contact person for deals
  const contactPerson = isDeal
    ? (lead.Contact_Name?.name || lead.Owner?.name || null)
    : null;
  
  // Get email (deals might not have direct email, use contact email if available)
  const email = lead.Email || lead.Contact_Name?.email || null;
  
  // Get formatted dates
  const createdDate = lead.Created_Time ? new Date(lead.Created_Time).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  }) : null;
  
  const modifiedDate = lead.Modified_Time ? new Date(lead.Modified_Time).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  }) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        {/* Header with Contact Info */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <Avatar className={cn('h-16 w-16 text-xl font-semibold', colorClass)}>
                  <AvatarFallback className={colorClass}>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-2xl font-bold">{displayName}</h1>
                    <InfoIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  
                  {companyName && (
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                      <Building2 className="h-4 w-4" />
                      <span className="font-medium">{companyName}</span>
                    </div>
                  )}
                  
                  {contactPerson && (
                    <p className="text-sm text-muted-foreground mb-3">
                      Contact: {contactPerson}
                    </p>
                  )}
                  
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    {email && (
                      <button
                        onClick={() => copyToClipboard(email, 'email')}
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group"
                      >
                        <Mail className="h-4 w-4" />
                        <span className="truncate">{email}</span>
                        {copiedEmail ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    )}
                    {lead.Phone && (
                      <button
                        onClick={() => copyToClipboard(lead.Phone!, 'phone')}
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group"
                      >
                        <Phone className="h-4 w-4" />
                        <span>{lead.Phone}</span>
                        {copiedPhone ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    )}
                    {lead.Website && (
                      <a 
                        href={lead.Website} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-primary hover:underline"
                      >
                        <Globe className="h-4 w-4" />
                        <span>Website</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  
                  {(createdDate || modifiedDate) && (
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-3 pt-3 border-t">
                      {createdDate && (
                        <span>Created: {createdDate}</span>
                      )}
                      {modifiedDate && (
                        <span>Last Modified: {modifiedDate}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="default" 
                  className="gap-2" 
                  onClick={onReevaluate}
                  disabled={isReevaluating}
                >
                  <RefreshCw className={cn("h-4 w-4", isReevaluating && "animate-spin")} />
                  {isReevaluating ? 'Reevaluating...' : 'Reevaluate'}
                </Button>
                {analysis?.confidence_level && (
                  <Badge 
                    variant={getConfidenceBadgeVariant(analysis.confidence_level)}
                    className="px-3 py-1.5 text-sm font-medium"
                  >
                    {analysis.confidence_level} Confidence
                  </Badge>
                )}
              </div>
            </div>

            {/* Fireflies Call Notes Indicator */}
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  {meetings && meetings.length > 0 ? (
                    <>
                      <PhoneCall className="h-4 w-4 text-green-600" />
                      <span>Fireflies notes available</span>
                      <Badge variant="outline" className="text-xs">
                        {meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'}
                      </Badge>
                    </>
                  ) : (
                    <>
                      <PhoneOff className="h-4 w-4" />
                      <span>No Fireflies notes</span>
                    </>
                  )}
                </div>
                {modifiedDate && meetings && meetings.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Synced: {modifiedDate}</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {/* Company Overview */}
            {analysis?.summary && (
              <Card className="border-0 shadow-sm overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-teal-500 to-cyan-500 text-white pb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    <CardTitle className="text-lg">Company Overview</CardTitle>
                  </div>
                  <p className="text-sm text-teal-50 mt-1">AI-powered analysis</p>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="border-l-4 border-primary pl-4 mb-6">
                    <p className="text-sm leading-relaxed">{analysis.summary}</p>
                  </div>
                  
                  {analysis.product_description && (
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="bg-purple-100 text-purple-700 p-2 rounded-lg">
                          <Lightbulb className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">PRODUCT</p>
                          <p className="text-sm font-semibold">{analysis.product_description}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex flex-wrap gap-2">
                    {analysis.country && (
                      <Badge variant="outline" className="gap-1.5 px-3 py-1 border-blue-200 bg-blue-50 text-blue-700">
                        <span className="text-xs font-medium">Country:</span>
                        <span className="font-semibold">{analysis.country}</span>
                      </Badge>
                    )}
                    {analysis.raise_stage && (
                      <Badge variant="outline" className="gap-1.5 px-3 py-1 border-amber-200 bg-amber-50 text-amber-700">
                        <span className="text-xs font-medium">Stage:</span>
                        <span className="font-semibold">{analysis.raise_stage}</span>
                      </Badge>
                    )}
                    {analysis.vertical && (
                      <Badge variant="outline" className="gap-1.5 px-3 py-1 border-purple-200 bg-purple-50 text-purple-700">
                        <span className="text-xs font-medium">Vertical:</span>
                        <span className="font-semibold">{analysis.vertical}</span>
                      </Badge>
                    )}
                    {analysis.business_model && (
                      <Badge variant="outline" className="gap-1.5 px-3 py-1 border-teal-200 bg-teal-50 text-teal-700">
                        <span className="text-xs font-medium">Model:</span>
                        <span className="font-semibold">{analysis.business_model}</span>
                      </Badge>
                    )}
                    {analysis.motion && (
                      <Badge variant="outline" className="gap-1.5 px-3 py-1 border-cyan-200 bg-cyan-50 text-cyan-700">
                        <span className="text-xs font-medium">Motion:</span>
                        <span className="font-semibold">{analysis.motion}</span>
                      </Badge>
                    )}
                    {analysis.company_size && (
                      <Badge variant="outline" className="gap-1.5 px-3 py-1 border-red-200 bg-red-50 text-red-700">
                        <span className="text-xs font-medium">Size:</span>
                        <span className="font-semibold">{analysis.company_size}</span>
                      </Badge>
                    )}
                  </div>
                  
                  {analysis.likely_icp_canada && (
                    <div className="mt-6 p-4 bg-teal-50 rounded-lg border border-teal-200">
                      <div className="flex items-start gap-2">
                        <Target className="h-4 w-4 text-teal-600 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-teal-900 uppercase tracking-wide mb-1">
                            LIKELY ICP IN CANADA
                          </p>
                          <p className="text-sm text-teal-700">{analysis.likely_icp_canada}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Meetings (Fireflies Notes) */}
            {meetings && meetings.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-100 text-blue-600 p-2.5 rounded-lg">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-semibold">Meetings ({meetings.length})</h2>
                </div>

                {meetings.map((meeting) => (
                  <div key={meeting.id} className="border rounded-lg overflow-hidden bg-card">
                    <button
                      onClick={() => setIsMeetingExpanded(!isMeetingExpanded)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 text-left">
                        <Calendar className="h-4 w-4 text-blue-600" />
                        <div>
                          <p className="font-medium text-sm">{meeting.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(meeting.date).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>
                      {isMeetingExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {isMeetingExpanded && (
                      <div className="border-t">
                        <div className="px-4 py-4">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                            NOTES
                          </p>
                          <div className="bg-blue-50/50 rounded-lg p-4 prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground">
                            <ReactMarkdown>{meeting.notes}</ReactMarkdown>
                          </div>

                          {meeting.action_items && (
                            <>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4 mt-6">
                                ACTION ITEMS
                              </p>
                              <div className="bg-amber-50/50 rounded-lg p-4 prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground">
                                <ReactMarkdown>{meeting.action_items}</ReactMarkdown>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : analysis?.notes && analysis.notes.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-100 text-blue-600 p-2.5 rounded-lg">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-semibold">Meetings ({analysis.notes.length})</h2>
                </div>

                <div className="border rounded-lg overflow-hidden bg-card">
                  <button
                    onClick={() => setIsMeetingExpanded(!isMeetingExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 text-left">
                      <Calendar className="h-4 w-4 text-blue-600" />
                      <div>
                        <p className="font-medium text-sm">TBDC Pivot Founder Discussion: {companyName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {createdDate || 'Recent'}
                        </p>
                      </div>
                    </div>
                    {isMeetingExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {isMeetingExpanded && (
                    <div className="border-t">
                      <div className="px-4 py-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                          NOTES
                        </p>
                        <div className="bg-blue-50/50 rounded-lg p-4 space-y-3">
                          {analysis.summary && (
                            <div className="text-sm leading-relaxed text-foreground">
                              <ReactMarkdown>{analysis.summary}</ReactMarkdown>
                            </div>
                          )}
                          {analysis.notes.map((note, index) => (
                            <div key={index} className="text-sm leading-relaxed text-foreground">
                              <p className="whitespace-pre-wrap">{note}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Key Insights */}
            {analysis?.key_insights && analysis.key_insights.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-purple-100 text-purple-700 p-2 rounded-lg">
                      <Lightbulb className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg">Key Insights</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {analysis.key_insights.map((insight, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                        <p className="text-sm leading-relaxed">{insight}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Questions to Ask */}
            {analysis?.questions_to_ask && analysis.questions_to_ask.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-teal-100 text-teal-700 p-2 rounded-lg">
                      <MessageCircleQuestion className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg">Questions to Ask Your Lead</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5">
                    {analysis.questions_to_ask.map((question, index) => (
                      <li key={index} className="flex items-start gap-3 py-1.5">
                        <span className="text-teal-600 font-semibold flex-shrink-0 text-sm">
                          {index + 1}.
                        </span>
                        <p className="text-sm leading-relaxed">{question}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Marketing Materials */}
            {marketing_materials && marketing_materials.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-green-100 text-green-700 p-2 rounded-lg">
                      <FileText className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg">Marketing Material</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {marketing_materials.slice(0, 5).map((material) => (
                      <a
                        key={material.material_id}
                        href={material.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 border rounded-lg hover:bg-accent hover:border-primary transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-sm mb-1 flex items-center gap-2">
                              {material.title}
                              <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            </h4>
                            <p className="text-xs text-muted-foreground mb-1">{material.industry}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">{material.business_topics}</p>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-4">
            {/* Fit Assessment */}
            {analysis?.fit_score !== undefined && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-teal-100 text-teal-700 p-2 rounded-lg">
                      <Target className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg">Fit Assessment</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-center mb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      FIT SCORE
                    </p>
                    <div className={cn(
                      'inline-flex items-center justify-center w-20 h-20 rounded-2xl text-3xl font-bold mb-2',
                      getFitScoreColor(analysis.fit_score)
                    )}>
                      {analysis.fit_score.toFixed(0)}
                    </div>
                    <p className={cn(
                      'text-sm font-semibold',
                      analysis.fit_score >= 8 ? 'text-green-700' :
                      analysis.fit_score >= 6 ? 'text-amber-700' : 'text-red-700'
                    )}>
                      {getFitScoreLabel(analysis.fit_score)}
                    </p>
                  </div>
                  
                  {analysis.fit_assessment && (
                    <p className="text-sm text-muted-foreground leading-relaxed text-center">
                      {analysis.fit_assessment}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Typical Customer / Target Group */}
            {similar_customers && similar_customers.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-green-100 text-green-700 p-2 rounded-lg">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg">Typical Customer / TG</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">
                    POTENTIAL CUSTOMERS
                  </p>
                  <div className="space-y-4">
                    {similar_customers.map((customer, index) => (
                      <div key={index} className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-semibold text-sm mb-0.5">{customer.name}</h4>
                            <Badge variant="outline" className="text-xs bg-white border-blue-300 text-blue-700">
                              {customer.industry}
                            </Badge>
                          </div>
                          {customer.website && (
                            <a
                              href={`https://${customer.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{customer.description}</p>
                        <p className="text-xs text-blue-700 italic leading-relaxed">{customer.why_similar}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
