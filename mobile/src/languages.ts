// Sierra Leone's main languages, for local bird names (ADM-02). Codes are ISO 639-3.
export const LANGUAGES = [
  { code: 'kri', label: 'Krio' },
  { code: 'men', label: 'Mende' },
  { code: 'tem', label: 'Temne' },
  { code: 'lia', label: 'Limba' },
  { code: 'kno', label: 'Kono' },
  { code: 'sus', label: 'Susu' },
  { code: 'fuf', label: 'Fula' },
] as const;

export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? (code ? code.toUpperCase() : 'Local');
