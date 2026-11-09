/**
 * levels.ts — los tres niveles educativos: nombre, colores, la línea de título
 * y el primer párrafo del texto del colegio, grupos y datos prácticos. Un solo
 * template (NivelPage) lo renderiza.
 *
 * El texto largo de cada nivel vive en levelStories.ts: este archivo lo
 * importa también la página del CMS (compartida con «/»), y el texto completo
 * pesaría en la portada.
 */
export interface LevelGroup {
  name: string;
  detail: string;
}

export interface LevelData {
  slug: 'preescolar' | 'primaria' | 'secundaria';
  name: string;
  accent: 'green' | 'coral' | 'purple';
  /** Official nivel color (tokens --nivel-*): Preescolar aqua, Primaria pink, Secundaria yellow. */
  color: string;
  hero: string;
  /** The document's title line, shown in the hero under the level's name. */
  headline: string;
  /** The document's first paragraph (hero lead; also the short summary other pages show). */
  intro: string;
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
    color: '#8ac6a4',
    hero: '/assets/hopscotch.webp',
    headline: 'Aprender también es jugar, descubrir y disfrutar',
    intro: 'Cuando un niño se divierte, se emociona y siente curiosidad, aprender sucede de manera natural.',
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
      'Kínder bilingüe en Tlalnepantla, de maternal a KIII: aprender jugando, proyectos en inglés y español, computación, música, deportes y yoga.',
  },
  {
    slug: 'primaria',
    name: 'Primaria',
    accent: 'coral',
    color: '#f4436c',
    hero: '/assets/court-primaria.webp',
    headline: 'Aprender tiene sentido',
    intro: 'Queremos que nuestros alumnos no solo sepan más. Queremos que sepan qué hacer con lo que aprenden.',
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
      'Primaria bilingüe e integral en Tlalnepantla: trabajo por proyectos, pocas tareas con propósito, Método Singapur, certificaciones de Cambridge, teatro, música y campamentos.',
  },
  {
    slug: 'secundaria',
    name: 'Secundaria',
    accent: 'purple',
    color: '#f1c82f',
    hero: '/assets/secundaria.webp',
    headline: 'Formación integral para la vida',
    intro: 'La Secundaria es una etapa de grandes cambios, descubrimientos y decisiones. Por eso, para nosotros educar va mucho más allá de enseñar contenidos.',
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
      'Secundaria en Tlalnepantla: aprender haciendo, certificaciones de Cambridge y Microsoft, LEGO® Education, Money Adventure en inglés, arte y viajes opcionales al extranjero.',
  },
];

export function getLevel(slug: string | undefined): LevelData | undefined {
  return LEVELS.find((l) => l.slug === slug);
}
