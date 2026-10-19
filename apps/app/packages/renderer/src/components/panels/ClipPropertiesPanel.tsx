import { useClipStore } from '@/lib/clip'
import { useControlsStore } from '@/lib/control'
import AudioProperties from '../properties/AudioProperties'
import VoiceChangerProperties from '../properties/VoiceChangerProperties'
import { soundSeparated } from '@/lib/audio-tools'
import React, { useMemo, useEffect } from 'react'
import { getMediaInfoCached } from '@/lib/media/utils'
import DurationProperties from '../properties/DurationProperties'
import PositionProperties from '../properties/PositionProperties'
import LayoutProperties from '../properties/LayoutProperties'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import AppearanceProperties from '../properties/AppearanceProperties'
import AdjustProperties from '../properties/AdjustProperties'
import { cn } from '@/lib/utils'
import TextBasicProperties from '../properties/text/TextBasicProperties'
import TextEffectsProperties from '../properties/text/TextEffectsProperties'
import LineProperties from '../properties/LineProperties'
import { useDrawingStore } from '@/lib/drawing';
import MaskPropertiesPanel from '../properties/mask/MaskPropertiesPanel';
import AnimationProperties, { KIND_LABEL, animationKinds } from '../properties/AnimationProperties'
import SpeedProperties from '../properties/SpeedProperties'
import FilterProperties from '../properties/FilterProperties'
import ShapeProperties from '../properties/ShapeProperties'
import { ImageClipProps, VideoClipProps } from '@/lib/types'
import { useInspectorStore } from '@/lib/inspector'
import TrackingProperties from '../properties/TrackingProperties'
import OpticalFlowProperties from '../properties/OpticalFlowProperties'

/**
 * The inspector for the selected clip (the last one selected), grouped as CapCut groups it:
 * a row of tabs by what's edited (Video, Audio, Speed, Animation, Adjust for a video; Text,
 * Animation, Duration for a text) and, inside a tab, sub-tabs (Basic, Mask). Each section is
 * one of the existing property panels.
 */

interface Section {
  id: string;
  label: string;
  content: React.ReactNode;
  /** Fills the tab's height and scrolls itself (for a footer pinned at the bottom). */
  own?: boolean;
}

interface InspectorTab {
  id: string;
  label: string;
  /** Shown as sub-tabs when there's more than one. */
  sections: Section[];
}

const stack = (...parts: React.ReactNode[]) => (
  <div className="min-w-0 divide-y divide-brand-divider">{parts}</div>
);

const ClipPropertiesPanel: React.FC = () => {
  const selectedClipIds = useControlsStore((s) => s.selectedClipIds);
  const selectedMaskId = useControlsStore((s) => s.selectedMaskId);
  const selectedLineId = useDrawingStore((s) => s.selectedLineId);
  const clipId = useMemo(() => selectedClipIds[selectedClipIds.length - 1], [selectedClipIds]);
  const clip = useClipStore((s) => s.getClipById(clipId));
  const type = clip?.type;
  const tab = useInspectorStore((s) => s.tab);
  const subs = useInspectorStore((s) => s.sub);
  const setTab = useInspectorStore((s) => s.setTab);
  const setSub = useInspectorStore((s) => s.setSub);

  // A video's Audio tab: its own sound, or CapCut's "Audio is separated" when that went to an
  // audio clip.
  const separated = useClipStore(() => soundSeparated(clip));
  const hasAudio = useMemo(() => {
    if (type === 'audio') return true;
    if (type === 'video') return separated || getMediaInfoCached((clip as VideoClipProps)?.assetId)?.audio !== null;
    return false;
  }, [type, separated, (clip as VideoClipProps | ImageClipProps)?.assetId]);

  const tabs = useMemo<InspectorTab[]>(() => {
    if (!clip) return [];
    const position = <PositionProperties key="position" clipId={clipId} />;
    const layout = <LayoutProperties key="layout" clipId={clipId} />;
    const appearance = <AppearanceProperties key="appearance" clipId={clipId} />;
    const duration = (label: string): InspectorTab => ({
      id: 'duration',
      label,
      sections: [{ id: 'duration', label, content: <DurationProperties clipId={clipId} /> }],
    });
    // CapCut's sub-tabs: In, Out and Combo (In, Out and Loop on a text).
    const animation: InspectorTab = {
      id: 'animation',
      label: 'Animation',
      sections: animationKinds(type!).map((kind) => ({ id: kind, label: KIND_LABEL[kind], own: true, content: <AnimationProperties clipId={clipId} kind={kind} /> })),
    };
    // Motion tracking (a text's, sticker's or photo's), as CapCut's Tracking tab.
    const tracking: InspectorTab = {
      id: 'tracking',
      label: 'Tracking',
      sections: [{ id: 'tracking', label: 'Tracking', own: true, content: <TrackingProperties clipId={clipId} /> }],
    };
    // A video's or a sound's Speed: Standard and Curve (a sound's has Standard only).
    const speed = (curve: boolean): InspectorTab => ({
      id: 'duration',
      label: 'Speed',
      sections: [
        { id: 'standard', label: 'Standard', own: true, content: <SpeedProperties clipId={clipId} mode="standard" /> },
        ...(curve ? [{ id: 'curve', label: 'Curve', own: true, content: <SpeedProperties clipId={clipId} mode="curve" /> }] : []),
      ],
    });
    // The Audio tools (CapCut's Basic and Voice changer): sub-tabs of a video's Audio tab, and
    // an audio clip's own tabs.
    const audioBasic: Section = { id: 'basic', label: 'Basic', content: <AudioProperties clipId={clipId} /> };
    const voiceChanger: Section = { id: 'voice', label: 'Voice changer', content: <VoiceChangerProperties clipId={clipId} /> };
    switch (type) {
      case 'video':
      case 'image':
        return [
          {
            id: 'video',
            label: type === 'video' ? 'Video' : 'Image',
            sections: [
              { id: 'basic', label: 'Basic', content: type === 'video' ? stack(position, layout, appearance, <OpticalFlowProperties key="optical-flow" clipId={clipId} />) : stack(position, layout, appearance) },
              { id: 'mask', label: 'Mask', content: <MaskPropertiesPanel clipId={clipId} /> },
            ],
          },
          ...(hasAudio ? [{ id: 'audio', label: 'Audio', sections: separated ? [audioBasic] : [audioBasic, voiceChanger] }] : []),
          type === 'video' ? speed(true) : duration('Duration'),
          animation,
          ...(type === 'image' ? [tracking] : []),
          { id: 'adjust', label: 'Adjust', sections: [{ id: 'adjust', label: 'Adjust', content: <AdjustProperties clipId={clipId} /> }] },
        ];
      case 'text':
        // CapCut's Text tab: Basic (with the clip's Transform and Blend among its sections)
        // and Effects. Its Bubble tab is CapCut's downloaded content, which OpenRip doesn't have.
        return [
          {
            id: 'text',
            label: 'Text',
            sections: [
              { id: 'basic', label: 'Basic', content: <TextBasicProperties clipId={clipId} transform={stack(position, layout, appearance)} /> },
              { id: 'effects', label: 'Effects', content: <TextEffectsProperties clipId={clipId} /> },
            ],
          },
          animation,
          tracking,
          duration('Duration'),
        ];
      // CapCut's Shapes tab: one scrolling column of groups (its Animation and Tracking tabs
      // aren't here: shapes don't animate in the engine yet, and tracking is out of scope).
      case 'shape':
        return [{ id: 'shape', label: 'Shapes', sections: [{ id: 'shape', label: 'Shapes', content: <ShapeProperties clipId={clipId} /> }] }];
      case 'audio':
        // CapCut's tabs for an audio clip: Basic, Voice changer, Speed.
        return [
          { id: 'audio', label: 'Basic', sections: [audioBasic] },
          { id: 'voice', label: 'Voice changer', sections: [voiceChanger] },
          speed(false),
        ];
      case 'filter':
        return [
          {
            id: 'filter',
            label: 'Filters',
            sections: [{ id: 'filter', label: 'Filter', content: stack(<FilterProperties key="filter" clipId={clipId} />) }],
          },
          // A draft's sticker tracks as CapCut's do.
          ...((clip as any).draftKind === 'sticker' ? [tracking] : []),
        ];
      case 'draw':
        return [
          ...(selectedLineId ? [{ id: 'line', label: 'Line', sections: [{ id: 'line', label: 'Line', content: <LineProperties clipId={clipId} /> }] }] : []),
          duration('Duration'),
        ];
      default:
        return [duration('Duration')];
    }
  }, [clip, clipId, type, hasAudio, separated, selectedLineId]);

  // A selected line or mask brings up its tab.
  useEffect(() => {
    if (selectedLineId && tabs.some((t) => t.id === 'line')) setTab('line');
  }, [selectedLineId, tabs.length]);
  useEffect(() => {
    if (selectedMaskId && tabs.some((t) => t.id === 'video')) setTab('video', 'mask');
  }, [selectedMaskId, tabs.length]);

  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  if (!current) return null;
  const section = current.sections.find((s) => s.id === subs[current.id]) ?? current.sections[0];

  // CapCut's tabs: 13 px semibold labels on the header strip, the selected one in the accent.
  const trigger =
    "h-full px-[13px] first:pl-[11px] shrink-0 whitespace-nowrap rounded-none bg-transparent text-[13px] font-semibold text-brand-light hover:text-brand-lighter data-[state=active]:text-brand-accent data-[state=active]:bg-transparent";

  return (
    <Tabs value={current.id} onValueChange={(v) => setTab(v)} className="h-full w-full min-w-0 flex flex-col overflow-hidden">
      <TabsList
        data-testid="inspector-tabs"
        style={{ scrollbarWidth: 'none' }}
        className="w-full justify-start shrink-0 h-[42px] p-0 gap-0 rounded-none bg-brand-header border-b-[0.5px] border-brand-hairline overflow-x-auto [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className={trigger}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="flex-1 min-h-0 m-0 flex flex-col">
          {t.id === current.id && (
            <Tabs value={section.id} onValueChange={(v) => setSub(t.id, v)} className="flex-1 min-h-0 flex flex-col">
              {/* Sub-tabs: CapCut's segmented control, its segments sharing the width. */}
              {t.sections.length > 1 && (
                <div className="shrink-0 px-3 pt-[13px] pb-[11px] border-b border-brand-divider">
                  <TabsList className="flex w-full h-6 p-0 gap-0 rounded-[4px] bg-brand">
                    {t.sections.map((s) => (
                      <TabsTrigger
                        key={s.id}
                        value={s.id}
                        className={cn(
                          "flex-1 !w-auto h-6 rounded-[4px] text-[12px] font-normal text-[#cccccc] hover:text-brand-lighter",
                          "data-[state=active]:bg-brand-background-light data-[state=active]:text-brand-lighter",
                        )}
                      >
                        {s.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              )}
              {section.own ? (
                t.sections.map((s) => (
                  <TabsContent key={s.id} value={s.id} className="flex-1 min-h-0 min-w-0 m-0 flex flex-col">
                    {s.content}
                  </TabsContent>
                ))
              ) : (
                <ScrollArea className="flex-1 min-h-0">
                  {t.sections.map((s) => (
                    <TabsContent key={s.id} value={s.id} className="min-w-0 m-0">
                      {s.content}
                    </TabsContent>
                  ))}
                </ScrollArea>
              )}
            </Tabs>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default ClipPropertiesPanel
