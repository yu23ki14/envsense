export const StorageKeys = {
  schemaVersion: 'schema:version',
  pairedDevice: 'device:paired',
  settings: 'settings',

  photo: (id: string) => `photo:${id}`,
  audio: (id: string) => `audio:${id}`,
  highlight: (id: string) => `highlight:${id}`,
  timeline: (id: string) => `timeline:${id}`,
  day: (date: string) => `day:${date}`,

  dateIndex: 'index:dates',
  photosByDay: (date: string) => `index:photos-by-day:${date}`,
  audiosByDay: (date: string) => `index:audios-by-day:${date}`,
  highlightsByDay: (date: string) => `index:highlights-by-day:${date}`,
  timelineByDay: (date: string) => `index:timeline-by-day:${date}`,
} as const;

export const StoragePrefixes = {
  photo: 'photo:',
  audio: 'audio:',
  highlight: 'highlight:',
  timeline: 'timeline:',
  day: 'day:',
} as const;
