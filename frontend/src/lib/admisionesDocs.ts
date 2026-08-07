/**
 * Documentación para el Examen de Valoración (Admisiones).
 * Fuente única para /admisiones y /admisiones/documentacion. Donde existe un
 * trámite oficial en línea se enlaza directo para facilitarlo a las familias.
 */
export interface AdmissionDoc {
  label: string;
  href?: string;
  linkLabel?: string;
}

export const ADMISSION_DOCS: AdmissionDoc[] = [
  { label: 'Acta de nacimiento: 1 original (solo cotejo) y 2 copias actualizadas tamaño carta',
    href: 'https://www.gob.mx/ActaNacimiento/', linkLabel: 'Obtener acta en línea' },
  { label: 'CURP del alumno (2 copias, emitida por RENAPO)',
    href: 'https://www.gob.mx/curp/', linkLabel: 'Consultar CURP' },
  { label: 'CURP de cada padre o tutor (1 copia, RENAPO)',
    href: 'https://www.gob.mx/curp/', linkLabel: 'Consultar CURP' },
  { label: 'INE de cada padre o tutor (1 copia ampliada al 200%)',
    href: 'https://www.ine.mx/credencial/', linkLabel: 'Trámites INE' },
  { label: '1 fotografía reciente tamaño infantil del alumno' },
  { label: 'Comprobante de domicilio vigente (menor a 3 meses, con dirección completa y C.P.)' },
  { label: 'Boleta SEP del grado anterior (1 copia)' },
  { label: 'Boletas internas de español e inglés del grado anterior y actual (1 copia c/u)' },
  { label: 'Certificado de primaria, si ya lo obtuvo (1 copia — ingreso a secundaria)' },
  { label: 'Carta de buena conducta' },
  { label: 'Constancia de no adeudo' },
];
