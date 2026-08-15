import { getFirestore } from 'firebase-admin/firestore';
import axios, { AxiosInstance } from 'axios';
import { refreshPcoToken } from './oauth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PcoOAuthConfig {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface PcoResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface PcoListResponse {
  data: PcoResource[];
  included?: PcoResource[];
  meta?: {
    total_count?: number;
    count?: number;
    next?: { offset?: number };
  };
  links?: {
    next?: string | null;
    self?: string;
  };
}

export interface PcoSingleResponse {
  data: PcoResource;
  included?: PcoResource[];
}

// ---------------------------------------------------------------------------
// PcoClient
// ---------------------------------------------------------------------------

const PCO_BASE_URL = 'https://api.planningcenteronline.com';
/** Token expiry buffer: refresh if token expires within 5 minutes */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class PcoClient {
  private readonly orgId: string;
  private accessToken = '';
  private http!: AxiosInstance;

  constructor(orgId: string) {
    this.orgId = orgId;
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Loads the PCO access token from Firestore.
   * Refreshes automatically if the token is expired (or close to expiry).
   */
  async init(): Promise<void> {
    const db = getFirestore();
    const configSnap = await db
      .collection('organizations')
      .doc(this.orgId)
      .collection('settings')
      .doc('config')
      .get();

    if (!configSnap.exists) {
      throw new Error(`No settings config found for org ${this.orgId}`);
    }

    const config = configSnap.data() as { pco_oauth?: PcoOAuthConfig };
    const oauth = config.pco_oauth;

    if (!oauth) {
      throw new Error(`PCO is not connected for org ${this.orgId}`);
    }

    const isExpired = oauth.expires_at - Date.now() < EXPIRY_BUFFER_MS;

    if (isExpired) {
      this.accessToken = await refreshPcoToken(this.orgId);
    } else {
      this.accessToken = oauth.access_token;
    }

    this.http = axios.create({
      baseURL: PCO_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // -------------------------------------------------------------------------
  // Core HTTP helpers
  // -------------------------------------------------------------------------

  /** Authenticated GET — returns raw response data. */
  async get(path: string, params?: Record<string, unknown>): Promise<PcoListResponse | PcoSingleResponse> {
    const response = await this.http.get<PcoListResponse | PcoSingleResponse>(path, { params });
    return response.data;
  }

  /**
   * Paginates through all pages of a list endpoint.
   * PCO uses offset-based pagination with a max of 100 records per page.
   */
  async getAll(path: string, params: Record<string, unknown> = {}): Promise<PcoResource[]> {
    const pageSize = 100;
    const allItems: PcoResource[] = [];
    let offset = 0;

    while (true) {
      const response = (await this.http.get<PcoListResponse>(path, {
        params: { ...params, per_page: pageSize, offset },
      })).data;

      const items = response.data ?? [];
      allItems.push(...items);

      const totalCount = response.meta?.total_count ?? items.length;
      offset += items.length;

      // Stop if we've fetched everything or the page was incomplete
      if (offset >= totalCount || items.length < pageSize) {
        break;
      }
    }

    return allItems;
  }

  // -------------------------------------------------------------------------
  // Services API
  // -------------------------------------------------------------------------

  /** Returns all service types for the organization. */
  async getServiceTypes(): Promise<PcoResource[]> {
    return this.getAll('/services/v2/service_types');
  }

  /**
   * Returns plans for a given service type that are in the future,
   * optionally limited to a window of `daysAhead` days.
   */
  async getPlansForServiceType(
    serviceTypeId: string,
    daysAhead = 60
  ): Promise<PcoResource[]> {
    const after = new Date().toISOString();
    const before = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    return this.getAll(`/services/v2/service_types/${serviceTypeId}/plans`, {
      filter: 'future',
      after,
      before,
    });
  }

  /**
   * Returns all plan_times for a specific plan within a service type.
   */
  async getPlanTimes(serviceTypeId: string, planId: string): Promise<PcoResource[]> {
    return this.getAll(
      `/services/v2/service_types/${serviceTypeId}/plans/${planId}/plan_times`
    );
  }

  // -------------------------------------------------------------------------
  // Groups API
  // -------------------------------------------------------------------------

  /** Returns all groups for the organization. */
  async getGroups(): Promise<PcoResource[]> {
    return this.getAll('/groups/v2/groups');
  }

  /**
   * Returns events for a given group within the next `daysAhead` days.
   */
  async getGroupEvents(groupId: string, daysAhead = 60): Promise<PcoResource[]> {
    const after = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const before = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    return this.getAll(`/groups/v2/groups/${groupId}/events`, {
      filter: 'upcoming',
      'where[starts_at][gte]': after,
      'where[starts_at][lte]': before,
    });
  }
}
