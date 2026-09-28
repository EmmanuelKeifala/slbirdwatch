// OBS-12. Values mirror the backend media_licence enum.
export type Licence = 'cc0' | 'cc-by' | 'cc-by-nc' | 'all-rights-reserved';

export const LICENCES: { value: Licence; label: string; hint: string }[] = [
  { value: 'cc-by-nc', label: 'CC BY-NC', hint: 'Others may reuse with credit, not commercially' },
  { value: 'cc-by', label: 'CC BY', hint: 'Others may reuse with credit' },
  { value: 'cc0', label: 'CC0', hint: 'No rights reserved' },
  { value: 'all-rights-reserved', label: 'All rights reserved', hint: 'Shown in the app only' },
];
