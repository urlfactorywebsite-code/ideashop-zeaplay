import { http } from './mockApi';
import type { ReportingDetail, ReportingOptions, ReportingOverview, ReportingPage, ReportingQuery, ReportSection } from '../types/reporting';

const read = async <T>(path: string, params: object, signal?: AbortSignal): Promise<T> =>
  (await http.get<T>(`/reports/${path}`, { params, signal, showGlobalProgress: false })).data;

export const reportingApi = {
  options: (params: object, signal?: AbortSignal) => read<ReportingOptions>('options', params, signal),
  overview: (params: ReportingQuery, signal?: AbortSignal) => read<ReportingOverview>('overview', params, signal),
  page: (section: Exclude<ReportSection, 'overview'>, params: ReportingQuery, signal?: AbortSignal) =>
    read<ReportingPage>(section, params, signal),
  detail: (section: 'employees' | 'projects', id: string, params: ReportingQuery, signal?: AbortSignal) =>
    read<ReportingDetail>(`${section}/${encodeURIComponent(id)}`, params, signal),
  sessions: (params: ReportingQuery & { active?: boolean }, signal?: AbortSignal) =>
    read<ReportingPage>('time/sessions', params, signal),
  async export(section: Exclude<ReportSection, 'overview'>, format: 'csv' | 'xlsx', params: ReportingQuery, signal?: AbortSignal) {
    try {
      const response = await http.get<Blob>('/reports/export', {
        params: { ...params, report: section, format }, signal, responseType: 'blob', showGlobalProgress: false,
      });
      const disposition = String(response.headers['content-disposition'] || '');
      const filename = disposition.match(/filename="?([^";]+)"?/)?.[1]?.replace(/[\\/\r\n]/g, '')
        || `zea-play-${section}-${params.from}-${params.to}.${format}`;
      return { blob: response.data, filename };
    } catch (error) {
      // Axios keeps JSON error responses as blobs when downloading a report.
      const response = (error as { response?: { data?: unknown } })?.response;
      if (response?.data instanceof Blob) {
        try { response.data = JSON.parse(await response.data.text()); } catch { /* Use the standard fallback error. */ }
      }
      throw error;
    }
  },
};
