/**
 * Editor field controls of the CMS (contract C5), shared by the section form
 * (BlockForm), Navegación and any console screen that edits site content.
 * Console-only: never import this from a public page or a section module.
 * See docs/cms/editor-fields.md for props and examples.
 */
export { TextField, type TextFieldProps } from './TextField';
export { TokenChips, insertAtCaret, useTokenValues, useResolvedText, TOKEN_LABELS, MAIN_TOKENS, MORE_TOKENS, type TokenName } from './TokenChips';
export { HrefInput, LinkField, LinkPickerDialog, useSitePages, type HrefInputProps, type LinkFieldProps, type LinkPickerDialogProps, type LinkValue } from './LinkField';
export {
  SITE_PAGES, SITE_ANCHORS, describeHref, hrefKind, hrefProblem, buildEmail, buildPhone, buildWeb, buildWhatsApp, parseWhatsApp,
  type SitePage, type HrefKind, type HrefInfo,
} from './links';
export { IconField, CMS_ICON_CHOICES, type IconChoice, type IconFieldProps } from './IconField';
export { ICON_NAMES, iconName } from './iconNames';
export { ColorField, SWATCH_GROUPS, contrastOnWhite, colorName, type ColorFieldProps, type Swatch } from './ColorField';
export { RichTextEditor, type RichTextEditorProps } from './RichTextEditor';
export { normalizeRichHtml } from './richHtml';
export { MarkTextField, MarkPreview, type MarkTextFieldProps } from './MarkTextField';
export { ImageField, MediaLibraryDialog, DEFAULT_MIN_WIDTH, type ImageFieldProps, type MediaLibraryDialogProps } from './ImageField';
export { useMediaAsset, useMediaLookup, useMediaUpload } from './media';
export { FormSelect, SITE_FORMS, type FormSelectProps } from './FormSelect';
export { FieldGroup, type FieldGroupProps } from './FieldGroup';
export { FieldLabel, FieldNotes, RequiredMark, describedBy, type FieldBaseProps } from './FieldShell';
