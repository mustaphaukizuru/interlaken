/**
 * levels.ts — contenido de los tres niveles educativos (fuente: material
 * institucional del colegio). Un solo template (NivelPage) lo renderiza.
 */
export interface LevelGroup {
  name: string;
  detail: string;
}

export interface LevelData {
  slug: 'preescolar' | 'primaria' | 'secundaria';
  name: string;
  accent: 'green' | 'coral' | 'purple';
  hero: string;
  intro: string;
  /** Sección "Modelo educativo / actividades" (viñetas). */
  modelTitle: string;
  model: string[];
  /** Grupos y capacidades. */
  groupsTitle: string;
  groups: LevelGroup[];
  extras: string[];
  seoDescription: string;
}

export const LEVELS: LevelData[] = [
  {
    slug: 'preescolar',
    name: 'Preescolar',
    accent: 'green',
    hero: '/assets/hopscotch.webp',
    intro:
      'Recibimos a los pequeños desde los dos años de edad en un entorno seguro y estimulante. Nuestro modelo bilingüe (Español–Inglés) integra Educación en Valores, Cantos y Juegos y Educación Física; a partir de 1º de Preescolar se suman Computación y Yoga.',
    modelTitle: 'Campos formativos',
    model: [
      'Lenguaje y comunicación',
      'Pensamiento matemático',
      'Exploración y conocimiento del mundo',
      'Desarrollo personal y social',
      'Expresión y apreciación artística',
      'Formación bilingüe Español–Inglés',
    ],
    groupsTitle: 'Cuatro grupos en este nivel',
    groups: [
      {
        name: 'Maternal',
        detail:
          'Ingreso a los dos años. Salones de 10 a 15 alumnos, atendidos por una educadora y una auxiliar.',
      },
      {
        name: '1º a 3er grado',
        detail:
          'Ingreso a 1º con tres años cumplidos. Grupos de 15 a 20 alumnos con maestra de Español, maestra de Inglés y una niñera.',
      },
    ],
    extras: [
      'Estudios con reconocimiento oficial de la Secretaría de Educación Pública (SEP).',
      'Al concluir el tercer grado, los alumnos reciben su Certificado de Educación Preescolar.',
    ],
    seoDescription:
      'Preescolar bilingüe desde los 2 años en Tlalnepantla: campos formativos SEP, valores, computación y yoga. Grupos reducidos de 10 a 20 alumnos.',
  },
  {
    slug: 'primaria',
    name: 'Primaria',
    accent: 'coral',
    hero: '/assets/court-primaria.webp',
    intro:
      'Educación de calidad basada en los Planes y Programas de la SEP y en el Modelo Educativo propio del colegio: alto nivel académico, sólida preparación y una excelente formación humana.',
    modelTitle: 'Modelo educativo',
    model: [
      'Educación bilingüe (Español–Inglés)',
      'Proyecto de Activación a la Inteligencia',
      'Educación en Valores',
      'Cultura Ecológica',
      'Educación Física y Educación Artística',
      'Educación Tecnológica (Computación)',
      'iPad integrado al salón de clases de 4º a 6º',
    ],
    groupsTitle: 'Seis grupos en este nivel',
    groups: [
      {
        name: '1º a 6º grado',
        detail:
          'Salones con capacidad de 20 a 25 alumnos, atendidos por maestra de Español, maestra de Inglés y maestros especialistas de Educación Física, Artística y Tecnológica.',
      },
    ],
    extras: [
      'Actividades complementarias y extraescolares: visitas, campañas, concursos, exposiciones, festivales y servicio a la comunidad.',
      'Acompañamiento del Departamento de Psicopedagogía.',
    ],
    seoDescription:
      'Primaria bilingüe en Tlalnepantla: planes SEP + modelo propio, activación a la inteligencia, valores, iPad de 4º a 6º. Grupos de 20 a 25 alumnos.',
  },
  {
    slug: 'secundaria',
    name: 'Secundaria',
    accent: 'purple',
    hero: '/assets/secundaria.webp',
    intro:
      'Formamos adolescentes competentes para la vida diaria y preparados para su siguiente nivel educativo, con un alto nivel académico y una excelente formación. El iPad se utiliza en el salón de clases.',
    modelTitle: 'Actividades que enriquecen el aprendizaje',
    model: [
      'Horas clase que enriquecen los Planes y Programas de la SEP',
      'Educación bilingüe con preparación para el First Certificate (Universidad de Cambridge)',
      'Taller de Lectura y Redacción',
      'Educación en Valores y Cultura Ecológica',
      'Educación Tecnológica con certificación en Word, Excel y PowerPoint',
      'ExpoInterlaken · Maratón de Conocimientos',
      'Orientación y tutoría de alumnos',
    ],
    groupsTitle: 'Seis grupos en este nivel',
    groups: [
      {
        name: '1º a 3er grado — dos grupos por grado',
        detail:
          'Salones con capacidad de 20 a 25 alumnos, con profesores altamente capacitados en actualización continua.',
      },
    ],
    extras: [
      'Actividades complementarias: visitas, exposiciones, concursos, conferencias, festivales, ceremonias y servicio a la comunidad.',
      'Actividades extraescolares deportivas y culturales.',
    ],
    seoDescription:
      'Secundaria bilingüe en Tlalnepantla: preparación Cambridge First Certificate, iPad en el aula, certificación Office. Grupos de 20 a 25 alumnos.',
  },
];

export function getLevel(slug: string | undefined): LevelData | undefined {
  return LEVELS.find((l) => l.slug === slug);
}
