import { useClipStore } from '@/lib/clip'
import { useControlsStore } from '@/lib/control'
import AudioProperties from '../properties/AudioProperties'
import { useMemo, useRef, useEffect, useState } from 'react'
import { getMediaInfoCached } from '@/lib/media/utils'
import DurationProperties from '../properties/DurationProperties'
import PositionProperties from '../properties/PositionProperties'
import LayoutProperties from '../properties/LayoutProperties'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import AppearanceProperties from '../properties/AppearanceProperties'
import AdjustProperties from '../properties/AdjustProperties'
import {LuChevronRight, LuChevronLeft} from 'react-icons/lu'
import { cn } from '@/lib/utils'
import TextProperties from '../properties/TextProperties'
import LineProperties from '../properties/LineProperties'
import { useDrawingStore } from '@/lib/drawing';
import { useViewportStore } from '@/lib/viewport';
import MaskPropertiesPanel from '../properties/mask/MaskPropertiesPanel';
import FilterProperties from '../properties/FilterProperties'
import { ImageClipProps, VideoClipProps } from '@/lib/types'

interface PropertiesPanelProps {
    panelSize: number;
}

const ClipPropertiesPanel:React.FC<PropertiesPanelProps> = ({panelSize}) => {
  const {selectedClipIds, selectedMaskId} = useControlsStore();
  const selectedLineId = useDrawingStore((s) => s.selectedLineId);
  const tool = useViewportStore((s) => s.tool);
  const clipId = useMemo(() => selectedClipIds[selectedClipIds.length - 1], [selectedClipIds]);
  const getClipById = useClipStore((s) => s.getClipById);
  const clip = getClipById(clipId);

  const clipType = clip?.type;
  const tabRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [selectedTab, setSelectedTab] = useState<string>(clip?.type === 'text' ? "text" : "transform");

  const hasDuration = true;

  const hasFilter = useMemo(() => {
    return clip?.type === 'filter';
  }, [clip?.type]);

  const hasAudio = useMemo(() => {
    if (clip?.type === 'audio') return true;
    if (clip?.type === 'video') {
      const mediaInfo = getMediaInfoCached(clip?.assetId)
      return mediaInfo?.audio !== null
    }
    return false;
  }, [clipType, (clip as VideoClipProps | ImageClipProps)?.assetId]);

  const hasAppearance = useMemo(() => {
    if (clip?.type === 'image' || clip?.type === 'video' || clip?.type === 'shape' || clip?.type === 'text') return true;
    return false;
  }, [clip?.type]);

  const hasTransform = useMemo(() => {
    if (clip?.type === 'image' || clip?.type === 'video' || clip?.type === 'shape' || clip?.type === 'text') return true;
    return false;
  }, [clip?.type]);

  const hasText = useMemo(() => {
    if (clip?.type === 'text') return true;
    return false;
  }, [clip?.type]);

  const hasAdjust = useMemo(() => {
    if (clip?.type === 'image' || clip?.type === 'video') return true;
    return false;
  }, [clip?.type]);

  const hasLine = useMemo(() => {
    if (clip?.type === 'draw' && selectedLineId) return true;
    return false;
  }, [clip?.type, selectedLineId]);

  const hasMask = useMemo(() => {
    // Show mask panel if a mask is selected OR if we're in mask tool mode

    if ((clip?.type === 'video' || clip?.type === 'image')) return true;
    return false;
  }, [selectedMaskId, tool, clip?.type]);

  const numVisibleTabs = useMemo(() => {
    let tabTotal = 0;
    if (hasLine) tabTotal++;
    if (hasMask) tabTotal++;
    if (hasTransform) tabTotal++;
    if (hasAudio) tabTotal++;
    if (hasDuration || hasFilter) tabTotal++;
    if (hasAppearance) tabTotal++;
    if (hasAdjust) tabTotal++;
    return tabTotal;
  }, [hasLine, hasMask, hasTransform, hasAudio, hasDuration, hasFilter, hasAppearance, hasAdjust]);


  useEffect(() => {
    // Automatically switch to line tab when a line is selected
    if (hasLine && selectedLineId) {
      setSelectedTab('line');
    }
  }, [selectedLineId, hasLine]);

  useEffect(() => {
    // Automatically switch to mask tab when a mask is selected
    if (hasMask && selectedMaskId) {
      setSelectedTab('mask');
    }
  }, [selectedMaskId, hasMask]);

  const checkScrollButtons = () => {
    if (tabRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  useEffect(() => {
    checkScrollButtons();
    const handleScroll = () => checkScrollButtons();
    const tabElement = tabRef.current;
    if (tabElement) {
      tabElement.addEventListener('scroll', handleScroll);
      return () => tabElement.removeEventListener('scroll', handleScroll);
    }
  }, [panelSize, numVisibleTabs]);


  const getValidTab = (currentTab: string) => {
    // Check if current tab is valid for this clip type

    if (currentTab === "line" && hasLine) return "line";

    if (currentTab === "text" && hasText) return "text";
    if (currentTab === "transform" && hasTransform) return "transform";
    if (currentTab === "mask" && hasMask) return "mask";
    if (currentTab === "audio" && hasAudio) return "audio";
    if (currentTab === "duration" && (hasDuration || hasFilter)) return "duration";
    if (currentTab === "appearance" && hasAppearance) return "appearance";
    if (currentTab === "adjust" && hasAdjust) return "adjust";
    // If current tab is invalid, return first available tab
    if (hasLine) return "line";
    if (hasTransform) return "transform";
    if (hasMask) return "mask";
    if (hasAudio) return "audio";
    if (hasAppearance) return "appearance";
    if (hasAdjust) return "adjust";
    return "duration"; // fallback
  };

  useEffect(() => {
    const validTab = getValidTab(selectedTab);
    if (validTab !== selectedTab) {
      setSelectedTab(validTab);
    }
  }, [clipId, hasLine, hasMask, hasTransform, hasAudio, hasDuration, hasAppearance, hasAdjust, tool]);


  return (
    <div className="h-full w-full min-w-0 flex flex-col" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="overflow-hidden" style={{ height: '100%' }}>
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="min-w-0 relative flex flex-col h-full">
        <div className="relative shrink-0 ">
          <LuChevronLeft onClick={() => {
            if (tabRef.current) {
              tabRef.current.scrollBy({ left: -96, behavior: 'smooth' });
            }
          }} className={cn("text-brand-light h-6 w-6 bg-brand-background-dark/90  backdrop-blur-sm border border-brand-light/10 hover:bg-brand-background z-50 transition-all duration-200 rounded-full absolute left-0 top-1/2 -translate-y-1/2 p-1 cursor-pointer ", canScrollLeft ? "block" : "hidden")} />
          <TabsList ref={tabRef} style={{scrollbarWidth: 'none', msOverflowStyle: 'none'}} className={cn("bg-brand w-full rounded-b-none p-0 min-w-0 shrink overflow-x-auto [&::-webkit-scrollbar]:hidden")}>
            {(hasLine) && <TabsTrigger value="line" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">Line</TabsTrigger>}
            {(hasText) && <TabsTrigger value="text" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">Text</TabsTrigger>}
            {(hasTransform) && <TabsTrigger value="transform" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">Transform</TabsTrigger>}
            {(hasMask) && <TabsTrigger value="mask" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">Mask</TabsTrigger>}
            {(hasAudio) && <TabsTrigger value="audio" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">Audio</TabsTrigger>}
            {(hasDuration || hasFilter) && <TabsTrigger value="duration" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">
              {hasFilter ? 'Filter' : 'Duration'}
              </TabsTrigger>}
            {(hasAdjust) && <TabsTrigger value="adjust" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">Adjust</TabsTrigger>}
            {(hasAppearance) && <TabsTrigger value="appearance" className="text-brand-light text-[11px] h-9 shrink-0 px-4.5 whitespace-nowrap">Appearance</TabsTrigger>}
          </TabsList>
          <LuChevronRight onClick={() => {
            if (tabRef.current) {
              tabRef.current.scrollBy({ left: 96, behavior: 'smooth' });
            }
          }} className={cn("text-brand-light h-6 w-6 border border-brand-light/10 bg-brand-background-dark/90 backdrop-blur-sm hover:bg-brand-background z-10 transition-all duration-200 rounded-full absolute right-0 top-1/2 -translate-y-1/2 p-1 cursor-pointer ", canScrollRight ? "block" : "hidden")} />
        </div>
        <ScrollArea className="flex-1 overflow-y-auto">
          <div>
          {(hasLine) && <TabsContent value="line" className="min-w-0 m-0">
            <LineProperties clipId={clipId} />
          </TabsContent>}
          {(hasText) && <TabsContent value="text" className="min-w-0 m-0">  <TextProperties clipId={clipId} /> </TabsContent>}
          {(hasTransform) && <TabsContent  value="transform" className="min-w-0 divide-y divide-brand-light/10 m-0">
            <PositionProperties clipId={clipId}  />
            <LayoutProperties clipId={clipId}  />
          </TabsContent>}
          {(hasMask) && <TabsContent value="mask" className="min-w-0 m-0">
            <MaskPropertiesPanel clipId={clipId} />
          </TabsContent>}
          {(hasAudio) && <TabsContent value="audio" className="min-w-0 m-0">
            <AudioProperties clipId={clipId} />
          </TabsContent>}
          {(hasDuration || hasFilter) && <TabsContent value="duration" className="min-w-0 m-0">
            {hasFilter && <FilterProperties clipId={clipId} />}
            <DurationProperties clipId={clipId} />
          </TabsContent>}
          {(hasAdjust) && <TabsContent value="adjust" className="min-w-0 m-0">
            <AdjustProperties clipId={clipId} />
          </TabsContent>}
          {(hasAppearance) && <TabsContent value="appearance" className="min-w-0 m-0">
            <AppearanceProperties clipId={clipId} />
          </TabsContent>}
          </div>
        </ScrollArea>
      </Tabs>
      </div>
    </div>
  )
}

export default ClipPropertiesPanel
