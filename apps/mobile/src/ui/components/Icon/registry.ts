/**
 * アイコン名 → lucide-react-native のアイコンコンポーネントの対応表。
 *
 * 画面・コンポーネントは Icon の `name`（このセマンティック名）だけを参照し、
 * lucide-react-native へ直接依存しない。アイコンライブラリを差し替えるときは
 * このファイルだけを書き換える。
 */
import {
  BatteryMedium,
  Bluetooth,
  BookText,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleQuestionMark,
  Cloud,
  Cpu,
  Download,
  Ear,
  Ellipsis,
  Gem,
  Globe,
  House,
  Image,
  List,
  Lock,
  type LucideIcon,
  Mic,
  MicOff,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react-native';

export const iconRegistry = {
  // ナビゲーション
  home: House,
  record: List,
  device: Cpu,
  journal: BookText,
  // デバイス・ステータス
  clip: Camera,
  battery: BatteryMedium,
  bluetooth: Bluetooth,
  wifi: Wifi,
  cpu: Cpu,
  // 操作
  search: Search,
  filter: SlidersHorizontal,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  close: X,
  more: Ellipsis,
  plus: Plus,
  edit: Pencil,
  share: Share,
  download: Download,
  refresh: RefreshCw,
  check: Check,
  // メディア・録音
  mic: Mic,
  micOff: MicOff,
  pause: Pause,
  play: Play,
  image: Image,
  // 意味づけ
  bolt: Zap,
  spark: Sparkles,
  ear: Ear,
  cloud: Cloud,
  lock: Lock,
  globe: Globe,
  trash: Trash2,
  help: CircleQuestionMark,
  gem: Gem,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof iconRegistry;
