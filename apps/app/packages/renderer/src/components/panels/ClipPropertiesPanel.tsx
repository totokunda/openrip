import { useClipStore } from '@/lib/clip'
import { useControlsStore } from '@/lib/control'
import AudioProperties from '../properties/AudioProperties'
import VoiceChangerProperties from '../properties/VoiceChangerProperties'
import { soundSeparated } from '@/lib/audio-tools'
import React, { useMemo, useEffect } from 'react'
import { getMediaInfoCached } from '@/lib/media/utils'
import DurationProperties from '../properties/DurationProperties'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import VideoBasicProperties from '../properties/VideoBasicProperties'
import ChromaKeyProperties from '../properties/ChromaKeyProperties'
import AdjustBasic from '../properties/adjust/AdjustBasic'
import AdjustHsl from '../properties/adjust/AdjustHsl'
import AdjustCurves from '../properties/adjust/AdjustCurves'
import AdjustWheels from '../properties/adjust/AdjustWheels'
import AdjustmentLayerProperties from '../properties/AdjustmentLayerProperties'
import AutoAdjust from '../properties/adjust/AutoAdjust'
import ColorMatch from '../properties/adjust/ColorMatch'
import { cn } from '@/lib/utils'
import TextBasicProperties from '../properties/text/TextBasicProperties'
import TextEffectsProperties from '../properties/text/TextEffectsProperties'
import CaptionListProperties from '../properties/CaptionListProperties'
import { isCaption } from '@/lib/caption-edit'
import LineProperties from '../properties/LineProperties'
import { useDrawingStore } from '@/lib/drawing';
import MaskPropertiesPanel from '../properties/mask/MaskPropertiesPanel';
import EffectMaskProperties from '../properties/mask/EffectMaskProperties';
import AnimationProperties, { KIND_LABEL, animationKinds } from '../properties/AnimationProperties'
import SpeedProperties from '../properties/SpeedProperties'
import FilterProperties from '../properties/FilterProperties'
import EffectProperties, { ClipEffectsProperties } from '../properties/EffectProperties'
import ShapeProperties from '../properties/ShapeProperties'
import { BlendSection, TransformSection } from '../properties/VideoBasicProperties'
import { ImageClipProps, VideoClipProps } from '@/lib/types'
import { useInspectorStore } from '@/lib/inspector'
import { allClips as deepClips, isCompound } from '@/lib/compound'
import TrackingProperties from '../properties/TrackingProperties'
import TemplateProperties from '../properties/TemplateProperties'
import OpticalFlowProperties from '../properties/OpticalFlowProperties'
import { DeflickerProperties, DenoiseProperties, MotionBlurProperties, StabilizeProperties } from '../properties/EnhanceProperties'
import { multiTabs, type InspectorSection, type InspectorTab } from '../properties/multi/multiTabs'

/**
 * The inspector for the selected clip (the last one selected), grouped as CapCut groups it:
 * a row of tabs by what's edited (Video, Audio, Speed, Animation, Adjust for a video; Text,
 * Animation, Duration for a text) and, inside a tab, sub-tabs (Basic, Mask). Each section is
 * one of the existing property panels.
 */

type Section = InspectorSection;

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
    // A compound has sound when any clip in it does.
    if (isCompound(clip)) return deepClips(clip.compound.clips).some((c) => c.type === 'audio' || (c.type === 'video' && !isCompound(c) && getMediaInfoCached((c as VideoClipProps).assetId)?.audio !== null));
    if (type === 'video') return separated || getMediaInfoCached((clip as VideoClipProps)?.assetId)?.audio !== null;
    return false;
  }, [type, separated, (clip as VideoClipProps | ImageClipProps)?.assetId]);

  // A text on a captions track gets the caption inspector (the list editor, Apply to all main captions).
  const captionClip = useClipStore((s) => isCaption(s.getClipById(clipId), s.timelines));

  // Several clips selected: CapCut's Properties tab, or its Video, Speed and Adjust for videos.
  const multi = selectedClipIds.length > 1;
  const allClips = useClipStore((s) => (multi ? s.clips : null));

  const tabs = useMemo<InspectorTab[]>(() => {
    if (!clip) return [];
    if (multi && allClips) return multiTabs(selectedClipIds, clipId, allClips);
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
    // A compound clip: the video inspector without what reads a file (stabilize and the rest of
    // the clean-up, Speed, auto adjust and colour match); it plays at speed 1.
    if (isCompound(clip)) {
      return [
        {
          id: 'video',
          label: 'Video',
          sections: [
            { id: 'basic', label: 'Basic', content: <VideoBasicProperties clipId={clipId} /> },
            { id: 'removebg', label: 'Remove BG', content: <ChromaKeyProperties clipId={clipId} /> },
            { id: 'mask', label: 'Mask', content: <MaskPropertiesPanel clipId={clipId} /> },
          ],
        },
        ...(hasAudio ? [{ id: 'audio', label: 'Audio', sections: [audioBasic] }] : []),
        animation,
        {
          id: 'adjust',
          label: 'Adjust',
          sections: [
            { id: 'basic', label: 'Basic', content: <AdjustBasic clipId={clipId} /> },
            { id: 'hsl', label: 'HSL', content: <AdjustHsl clipId={clipId} /> },
            { id: 'curves', label: 'Curves', content: <AdjustCurves clipId={clipId} /> },
            { id: 'wheels', label: 'Color wheel', content: <AdjustWheels clipId={clipId} /> },
            { id: 'effects', label: 'Effects', content: <ClipEffectsProperties clipId={clipId} /> },
          ],
        },
      ];
    }
    switch (type) {
      case 'video':
      case 'image':
        // CapCut's tabs for a video and for a photo alike (a photo's first tab is "Video" too).
        return [
          {
            id: 'video',
            label: 'Video',
            sections: [
              { id: 'basic', label: 'Basic', content: type === 'video' ? stack(
                <VideoBasicProperties key="basic" clipId={clipId} />,
                // CapCut's order: Stabilize, Reduce image noise, Optical flow, then Remove flickers
                // (its Enhance quality and the AI tools between are not offered); Motion blur,
                // which CapCut keeps in the clip menu's Enhance motion, goes last.
                <StabilizeProperties key="stabilize" clipId={clipId} />,
                <DenoiseProperties key="denoise" clipId={clipId} />,
                <OpticalFlowProperties key="optical-flow" clipId={clipId} />,
                <DeflickerProperties key="deflicker" clipId={clipId} />,
                <MotionBlurProperties key="motion-blur" clipId={clipId} />,
              ) : <VideoBasicProperties clipId={clipId} /> },
              { id: 'removebg', label: 'Remove BG', content: <ChromaKeyProperties clipId={clipId} /> },
              { id: 'mask', label: 'Mask', content: <MaskPropertiesPanel clipId={clipId} /> },
            ],
          },
          ...(hasAudio ? [{ id: 'audio', label: 'Audio', sections: separated ? [audioBasic] : [audioBasic, voiceChanger] }] : []),
          type === 'video' ? speed(true) : duration('Duration'),
          animation,
          ...(type === 'image' ? [tracking] : []),
          {
            id: 'adjust',
            label: 'Adjust',
            sections: [
              // CapCut's Basic opens with Auto adjust and Color match.
              { id: 'basic', label: 'Basic', content: stack(<AutoAdjust key="auto" clipId={clipId} />, <ColorMatch key="match" clipId={clipId} />, <AdjustBasic key="basic" clipId={clipId} />) },
              { id: 'hsl', label: 'HSL', content: <AdjustHsl clipId={clipId} /> },
              { id: 'curves', label: 'Curves', content: <AdjustCurves clipId={clipId} /> },
              { id: 'wheels', label: 'Color wheel', content: <AdjustWheels clipId={clipId} /> },
              { id: 'effects', label: 'Effects', content: <ClipEffectsProperties clipId={clipId} /> },
            ],
          },
        ];
      case 'text':
        // CapCut's Text tab: Basic (with the clip's Transform and Blend among its sections)
        // and Effects. Its Bubble tab is CapCut's downloaded content, which OpenRip doesn't have.
        return [
          // A caption (on a captions track) has CapCut's Captions tab first: the list editor and Find and replace.
          ...(captionClip ? [{ id: 'captions', label: 'Captions', sections: [{ id: 'list', label: 'Captions', own: true, content: <CaptionListProperties clipId={clipId} /> }] }] : []),
          {
            id: 'text',
            label: 'Text',
            sections: [
              { id: 'basic', label: 'Basic', content: <TextBasicProperties clipId={clipId} captionsTrack={captionClip} transform={stack(<TransformSection key="transform" clipId={clipId} />, <BlendSection key="blend" clipId={clipId} />)} /> },
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
      // CapCut's sticker clip: Stickers (its Transform), Animation (In, Out, Loop) and Tracking.
      case 'sticker':
        return [
          { id: 'sticker', label: 'Stickers', sections: [{ id: 'sticker', label: 'Stickers', content: <TransformSection clipId={clipId} /> }] },
          animation,
          tracking,
        ];
      case 'audio':
        // CapCut's tabs for an audio clip: Basic, Voice changer, Speed.
        return [
          { id: 'audio', label: 'Basic', sections: [audioBasic] },
          { id: 'voice', label: 'Voice changer', sections: [voiceChanger] },
          speed(false),
        ];
      case 'filter':
        // An adjustment layer: CapCut's Adjust tab (the video Adjust tab's panels and Mask).
        if ((clip as any).adjustment) {
          const own = (content: React.ReactNode) => <AdjustmentLayerProperties clipId={clipId}>{content}</AdjustmentLayerProperties>;
          return [
            {
              id: 'adjust',
              label: 'Adjust',
              sections: [
                { id: 'basic', label: 'Basic', own: true, content: own(<AdjustBasic key="basic" clipId={clipId} />) },
                { id: 'hsl', label: 'HSL', own: true, content: own(<AdjustHsl clipId={clipId} />) },
                { id: 'curves', label: 'Curves', own: true, content: own(<AdjustCurves clipId={clipId} />) },
                { id: 'wheels', label: 'Color wheel', own: true, content: own(<AdjustWheels clipId={clipId} />) },
                { id: 'mask', label: 'Mask', own: true, content: own(<MaskPropertiesPanel clipId={clipId} />) },
              ],
            },
          ];
        }
        // One of OpenRip's own video effects: CapCut's "Special effects" with its Details.
        if ((clip as any).effectId) {
          // Basic (its Details) and Mask (CapCut's `23-inspector-effect/002-fade-in-mask`): the effect
          // is drawn only inside the bar's masks.
          return [
            {
              id: 'filter',
              label: 'Special effects',
              sections: [
                { id: 'basic', label: 'Basic', content: stack(<EffectProperties key="effect" clipId={clipId} />) },
                { id: 'mask', label: 'Mask', content: <EffectMaskProperties clipId={clipId} /> },
              ],
            },
          ];
        }
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
      // A text template's group: its words as fields (lib/text-templates.ts).
      case 'group':
        return [
          ...((clip as any).template ? [{ id: 'template', label: 'Text template', sections: [{ id: 'fields', label: 'Fields', content: <TemplateProperties clipId={clipId} /> }] }] : []),
          duration('Duration'),
        ];
      default:
        return [duration('Duration')];
    }
  }, [clip, clipId, type, captionClip, hasAudio, separated, selectedLineId, multi, selectedClipIds, multi ? allClips : null]);

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
