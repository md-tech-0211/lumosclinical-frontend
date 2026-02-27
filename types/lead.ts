export interface Lead {
  id: string;
  Company?: string;
  Last_Name?: string;
  First_Name?: string;
  Email?: string;
  Phone?: string;
  Lead_Status?: string;
  Modified_Time?: string;
  Created_Time?: string;
  Lead_Source?: string;
  Industry?: string;
  Annual_Revenue?: number;
  Website?: string;
  Description?: string;
  Street?: string;
  City?: string;
  State?: string;
  Zip_Code?: string;
  Country?: string;
  Designation?: string;
  LinkedIn_Profile?: string;
  [key: string]: any;
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  notes: string;
  action_items?: string;
}

export interface LeadAnalysis {
  company_name?: string;
  country?: string;
  region?: string;
  summary?: string;
  product_description?: string;
  vertical?: string;
  business_model?: string;
  motion?: string;
  raise_stage?: string;
  company_size?: string;
  likely_icp_canada?: string;
  fit_score?: number;
  fit_assessment?: string;
  key_insights?: string[];
  questions_to_ask?: string[];
  confidence_level?: string;
  notes?: string[];
}

export interface MarketingMaterial {
  material_id: string;
  title: string;
  link: string;
  industry: string;
  business_topics: string;
  similarity_score: number;
}

export interface SimilarCustomer {
  name: string;
  description: string;
  industry: string;
  website: string;
  why_similar: string;
}

export interface LeadDetailResponse {
  data: Lead;
  analysis?: LeadAnalysis;
  analysis_available?: boolean;
  marketing_materials?: MarketingMaterial[];
  similar_customers?: SimilarCustomer[];
  meetings?: Meeting[];
  from_cache?: boolean;
}

export interface LeadsResponse {
  data: Lead[];
  info: {
    count: number;
    page: number;
    per_page: number;
    more_records: boolean;
  };
}
