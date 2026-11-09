/**
 * levels.ts — contenido de los tres niveles educativos. Un solo template
 * (NivelPage) lo renderiza.
 *
 * Los textos de `intro` y `story` son los del colegio, palabra por palabra
 * (documentos KÍNDER, PRIMARIA y SECUNDARIA del 2026-11-08). Lo que el
 * documento marca en negritas va entre **dobles asteriscos**; un párrafo
 * entero en negritas es una cita destacada (`quote`). Solo se corrigieron dos
 * erratas de formato: «q**ueremos» y «sus ideas ,».
 */
export interface LevelGroup {
  name: string;
  detail: string;
}

/** A program the text names, shown as a card: its name and the document's own sentence about it. */
export interface LevelProgram {
  name: string;
  icon: 'reading' | 'speaking' | 'math';
  text: string;
}

export type StoryBlock =
  | { p: string }
  | { quote: string }
  | { programs: LevelProgram[] };

export interface StorySection {
  /** Absent for the opening, which runs straight from the hero. */
  title?: string;
  blocks: StoryBlock[];
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
  story: StorySection[];
  /** A photo of the school placed after the given story section. */
  photo: { src: string; alt: string; after: number };
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
    story: [
      {
        blocks: [
          { p: 'En nuestro Kínder queremos que los niños disfruten esta etapa mientras descubren todo lo que son capaces de hacer. Por eso buscamos que cada experiencia tenga un propósito: jugar, explorar, preguntar, crear, experimentar, convivir y, casi sin darse cuenta, **desarrollen habilidades que serán la base de sus futuros aprendizajes**.' },
          { p: 'Porque en estos primeros años no se trata de acumular conceptos, **se trata de aprender con sentido.**' },
        ],
      },
      {
        title: 'Menos memorizar. Más experimentar.',
        blocks: [
          { p: 'Los niños aprenden haciendo; por eso trabajamos a través de experiencias y **proyectos tanto en inglés como en español**, que despiertan su curiosidad y les permiten relacionar lo que aprenden con el mundo que los rodea.' },
          { p: 'Queremos que pregunten, prueben, se equivoquen, vuelvan a intentarlo y encuentren respuestas.' },
          { p: 'Así construimos **aprendizajes significativos** que van mucho más allá de memorizar información.' },
        ],
      },
      {
        title: 'Bilingües desde pequeños',
        blocks: [
          { p: 'En esta etapa, los niños tienen una enorme capacidad para acercarse a un segundo idioma de manera natural.' },
          { p: 'Nuestra propuesta es **bilingüe desde maternal hasta KIII** y el inglés forma parte de su experiencia cotidiana.' },
          { p: 'Los niños escuchan, comprenden, hablan y participan en actividades y proyectos en ambos idiomas. Además, durante su paso por Kínder desarrollan progresivamente las habilidades necesarias para **aprender a leer y escribir tanto en español como en inglés**.' },
          { p: 'No buscamos únicamente que conozcan palabras en otro idioma, **queremos que aprendan a comunicarse en él.**' },
        ],
      },
      {
        title: 'Aprender también es moverse, crear y encontrar la calma',
        blocks: [
          { p: 'Un niño necesita mucho más que lápices y cuadernos para desarrollarse, por eso nuestra propuesta incluye **computación, música, deportes y yoga**.' },
          { p: 'Cada una de estas experiencias aporta algo diferente: creatividad, coordinación, expresión, movimiento, concentración, conciencia corporal y herramientas para reconocer y regular sus emociones. Aprender a detenerse, respirar y reconocer cómo se sienten también es parte muy importante del crecimiento.' },
        ],
      },
      {
        title: '“¡Yo puedo hacerlo!”',
        blocks: [
          { p: 'Una de las cosas más importantes que un niño puede descubrir durante estos años es que puede hacer cada vez más cosas por sí mismo.' },
          { p: 'Acompañamos a nuestros alumnos para que desarrollen **autonomía e independencia** de acuerdo con su edad: tomar pequeñas decisiones, asumir responsabilidades, resolver situaciones cotidianas y pedir ayuda cuando la necesitan.' },
          { p: 'No hacemos todo por ellos, **los acompañamos para que descubran que pueden hacerlo,** mientras les enseñamos y los animamos en el proceso.' },
        ],
      },
      {
        title: 'Saber convivir también se aprende',
        blocks: [
          { p: 'Compartir, esperar un turno, expresar lo que sienten, escuchar a los demás, resolver un desacuerdo o aprender que no todos pensamos igual son aprendizajes fundamentales.' },
          { p: 'Por eso damos especial importancia a la **socialización y al desarrollo emocional**.' },
          { p: 'Queremos que nuestros niños aprendan a reconocer y expresar sus emociones, construir relaciones positivas y convivir con otros dentro de un ambiente donde prevalezcan **el respeto, la tolerancia, la diversión y el amor**; sabiendo que el sentirse seguro y querido abre la puerta al aprendizaje.' },
        ],
      },
      {
        title: 'Cada niño tiene su propio ritmo',
        blocks: [
          { p: 'No todos los niños aprenden de la misma manera ni al mismo tiempo. Y eso importa.' },
          { p: 'Nuestro equipo docente acompaña de manera cercana el desarrollo de cada alumno, observa sus avances, reconoce sus fortalezas e identifica las áreas en las que necesita mayor apoyo.' },
          { p: 'Ese acompañamiento también incluye a las familias. Promovemos una comunicación **cercana, constante y abierta entre familia y escuela**, porque cuando los adultos que acompañan a un niño trabajan juntos, podemos comprender mejor sus necesidades y ayudarlo a crecer.' },
        ],
      },
      {
        title: 'Niños felices que descubren todo lo que pueden lograr',
        blocks: [
          { p: 'Queremos que nuestros alumnos terminen el Kínder sabiendo muchas cosas, por supuesto. Pero queremos algo más: que sean **curiosos, autónomos, seguros, creativos y capaces de convivir con los demás**. Que sepan expresar lo que sienten, que disfruten aprender y que lleguen a Primaria con las herramientas necesarias para enfrentar con confianza una nueva etapa.' },
          { p: 'Porque durante los primeros años se construyen mucho más que conocimientos; **se construye la confianza para aprender, la seguridad para intentarlo y el gusto por descubrir.** Y la mejor manera de comenzar la vida estudiantil es muy sencilla: **aprendiendo jugando y siendo feliz.**' },
        ],
      },
    ],
    photo: { src: '/assets/campus-mural.webp', alt: 'Patio del colegio con toldos rojos y muros pintados de colores', after: 3 },
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
    story: [
      {
        blocks: [
          { p: 'En Primaria acompañamos una etapa increíble: los niños descubren de qué son capaces, empiezan a construir su propia forma de pensar y desarrollan herramientas que utilizarán durante toda su vida.' },
          { p: 'Por eso nuestra propuesta es **bilingüe e integral**. Buscamos el equilibrio entre una sólida preparación académica, el desarrollo de habilidades y competencias, la creatividad, el arte, la autonomía y la formación personal.' },
        ],
      },
      {
        title: 'Menos memorizar. Más comprender, pensar y hacer.',
        blocks: [
          { p: 'Aprender no debería significar únicamente recordar información para un examen.' },
          { p: 'Nuestros alumnos investigan, preguntan, experimentan, colaboran, resuelven problemas y llevan lo aprendido a situaciones concretas. A través del **trabajo por proyectos**, conectamos distintas áreas del conocimiento y acercamos el aprendizaje a la vida real.' },
          { p: 'Porque cuando un niño entiende para qué sirve lo que aprende, **el conocimiento cobra sentido**.' },
        ],
      },
      {
        title: 'Tareas que suman, no tareas por cumplir',
        blocks: [
          { p: 'Creemos que una buena educación no se mide por la cantidad de tarea que un niño lleva a casa.' },
          { p: 'Por eso buscamos que las **tareas sean pocas, relevantes y con un propósito claro**: reforzar aprendizajes importantes y favorecer la autonomía, sin convertir las tardes familiares en una extensión de la jornada escolar.' },
          { quote: 'Más tarea no siempre significa más aprendizaje.' },
        ],
      },
      {
        title: 'Herramientas para aprender mejor',
        blocks: [
          { p: 'Contamos con programas específicos que fortalecen habilidades fundamentales para el desarrollo académico y personal.' },
          {
            programs: [
              { name: 'Lee y Produce', icon: 'reading', text: '**Lee y Produce** impulsa la comprensión lectora y la capacidad de organizar y expresar ideas por escrito.' },
              { name: 'Habilidades Orales', icon: 'speaking', text: '**Habilidades Orales** ayuda a nuestros alumnos a comunicar lo que piensan, argumentar, escuchar y expresarse con claridad y seguridad.' },
              { name: 'Método Singapur', icon: 'math', text: 'Con el **Método Singapur**, las matemáticas se trabajan desde la comprensión, el razonamiento y la resolución de problemas, para que los niños no solo aprendan procedimientos, sino que entiendan cómo y cuándo utilizarlos.' },
            ],
          },
        ],
      },
      {
        title: 'Bilingües para comunicarse con el mundo',
        blocks: [
          { p: 'El inglés forma parte de la experiencia cotidiana de nuestros alumnos.' },
          { p: 'Nuestra propuesta bilingüe busca que desarrollen las herramientas necesarias para **comprender, comunicarse y desenvolverse en inglés con confianza**.' },
          { p: 'Además, nuestros alumnos tienen la oportunidad de presentar **certificaciones de Cambridge**, que permiten respaldar y reconocer su avance en el dominio del idioma a lo largo de su formación, mismas que les son de utilidad en su vida académica, así como en su futuro laboral.' },
        ],
      },
      {
        title: 'Aprender también es prepararse para la vida',
        blocks: [
          { p: 'Hay conocimientos que difícilmente caben en un libro.' },
          { p: 'A través de **Emprendimiento y Finanzas**, acercamos a los niños desde edades tempranas a conceptos y experiencias que les ayudan a comprender mejor el mundo que los rodea.' },
          { p: 'Buscamos desarrollar iniciativa, creatividad, toma de decisiones, responsabilidad y una relación cada vez más consciente con el dinero y los recursos.' },
          { p: 'No se trata solamente de aprender conceptos. Se trata de comenzar a desarrollar **habilidades prácticas para la vida**.' },
        ],
      },
      {
        title: 'También se aprende creando',
        blocks: [
          { p: 'El desarrollo de un niño no sucede solamente frente a un cuaderno.' },
          { p: 'El **teatro y la música** forman parte de nuestra propuesta porque ofrecen otras maneras de aprender, expresarse y descubrir talentos.' },
          { p: 'A través de estas experiencias fortalecemos la creatividad, la sensibilidad, la comunicación, la seguridad personal y el trabajo en equipo.' },
        ],
      },
      {
        title: 'Hay aprendizajes que necesitan salir del salón',
        blocks: [
          { p: 'Creemos que algunas de las experiencias que más ayudan a crecer a un niño suceden cuando tiene la oportunidad de enfrentarse a nuevos retos.' },
          { p: 'Por eso los **campamentos** también forman parte de nuestra propuesta educativa.' },
          { p: 'Salir de su entorno cotidiano, convivir con sus compañeros y asumir pequeñas responsabilidades les permite poner en práctica algo fundamental: **aprender a hacer las cosas por sí mismos**.' },
          { p: 'Estas experiencias favorecen la autonomía, la independencia, la socialización, la capacidad de adaptación y la confianza en sí mismos.' },
          { p: 'Porque crecer también significa descubrir:' },
          { quote: '“Yo puedo hacerlo.”' },
        ],
      },
      {
        title: 'Educación para la escuela. Formación para la vida.',
        blocks: [
          { p: 'Queremos niños curiosos, seguros, capaces de expresar sus ideas, trabajar con otros, resolver problemas, tomar decisiones y seguir aprendiendo.' },
          { p: 'Niños que poco a poco desarrollen la autonomía necesaria para enfrentar nuevos retos y la sensibilidad para convivir y construir con los demás.' },
          { p: 'Por eso entendemos la educación de manera integral: **mente, emociones, creatividad, valores, habilidades y conocimiento trabajando juntos.**' },
          { p: 'Porque la Primaria no es solamente una etapa para aprender contenidos.' },
          { quote: 'Es el momento de aprender a pensar, a crear, a convivir, a ser más independientes y a descubrir todo lo que son capaces de hacer.' },
        ],
      },
    ],
    photo: { src: '/assets/classroom.webp', alt: 'Pasillo de salones de Primaria con puertas rojas y barandal de colores', after: 2 },
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
    story: [
      {
        blocks: [
          { p: 'Acompañamos a nuestros alumnos para que descubran de lo que son capaces, fortalezcan su identidad y desarrollen las herramientas académicas, personales y sociales que necesitarán dentro y fuera de la escuela.' },
          { quote: 'Queremos jóvenes preparados para el futuro, pero también seguros de quiénes son.' },
        ],
      },
      {
        title: 'Aprender haciendo, preguntando y descubriendo',
        blocks: [
          { p: 'Creemos que se aprende mejor cuando lo que sucede en el salón tiene sentido.' },
          { p: 'Por eso nuestras clases son dinámicas y trabajamos por proyectos que conectan los contenidos con situaciones de la vida real. Los alumnos investigan, hacen preguntas, trabajan en equipo, buscan soluciones, toman decisiones y aprenden a llevar lo que saben a la práctica.' },
          { quote: 'Porque aprender no es memorizar. Es entender, cuestionar, crear y saber qué hacer con lo que aprendemos.' },
        ],
      },
      {
        title: 'Pocas tareas, pero con propósito',
        blocks: [
          { p: 'No creemos en llenar las tardes de tareas sólo por cumplir. Buscamos que sean **pocas, significativas y con un objetivo claro**.' },
          { p: 'Las actividades en casa están pensadas para reforzar lo aprendido, pero también para despertar la curiosidad, promover la investigación y dar espacio a la creatividad.' },
          { quote: 'Menos tareas por hacer. Más razones para aprender.' },
        ],
      },
      {
        title: 'Tecnología sí. Habilidades fundamentales, también.',
        blocks: [
          { p: 'Nuestros alumnos crecen rodeados de tecnología y queremos que sepan aprovecharla. Pero también sabemos que su uso cotidiano puede hacer que algunas habilidades fundamentales reciban menos atención.' },
          { p: 'Por eso hacemos especial hincapié en fortalecer capacidades como la **comprensión lectora**, la atención, el análisis, la expresión de ideas y el pensamiento crítico.' },
          { p: 'La tecnología es una gran herramienta cuando los alumnos también saben **leer, comprender, pensar, cuestionar y crear**.' },
        ],
      },
      {
        title: 'Preparados para un mundo global',
        blocks: [
          { p: 'El inglés y la tecnología forman parte natural de su preparación. Nuestros alumnos pueden acceder a certificaciones de **Cambridge** y **Microsoft**, que les permiten avanzar con herramientas útiles para las siguientes etapas de su vida académica.' },
          { p: 'Además, a través de **LEGO® Education**, aprenden construyendo, experimentando y resolviendo retos mientras desarrollan creatividad, pensamiento lógico y trabajo en equipo.' },
          { quote: 'El futuro no sólo se estudia. Se construye.' },
        ],
      },
      {
        title: 'Money Adventure: aprender para la vida',
        blocks: [
          { p: 'Hablar de dinero también es hablar de decisiones, responsabilidad y autonomía.' },
          { p: 'En **Money Adventure**, una clase impartida en inglés, nuestros alumnos comienzan a desarrollar habilidades financieras de una manera práctica y cercana a su realidad. Aprenden, por ejemplo, a elaborar presupuestos, calcular costos, vender productos y tomar decisiones sobre el uso del dinero.' },
          { p: 'Así, mientras practican inglés, adquieren herramientas que podrán utilizar durante toda su vida.' },
          { quote: 'Porque aprender a manejar el dinero también es aprender a tomar mejores decisiones.' },
        ],
      },
      {
        title: 'Aprender a desenvolverse en el mundo',
        blocks: [
          { p: 'Crecer también significa aprender a hacer las cosas por uno mismo; por eso ofrecemos viajes opcionales al extranjero en los que nuestros alumnos viven una experiencia que va mucho más allá de conocer otro país. Viajan acompañados por personal de la escuela, pero son ellos quienes, de acuerdo con su edad, comienzan a hacerse responsables de aspectos importantes del viaje: administrar sus gastos, cuidar su equipaje, manejar sus documentos de viaje, organizar sus pertenencias y tomar decisiones durante el camino.' },
          { p: 'Estas experiencias les permiten poner en práctica su autonomía, capacidad de planeación, comunicación, responsabilidad y solución de problemas en situaciones reales, siempre dentro de un entorno acompañado y seguro.' },
          { p: 'También aprenden a adaptarse, convivir, llegar a acuerdos y enfrentar pequeños retos lejos de su rutina habitual.' },
          { quote: 'Porque hay aprendizajes que sólo ocurren cuando se atreven a salir, descubrir y hacer las cosas por sí mismos.' },
        ],
      },
      {
        title: 'El arte también forma',
        blocks: [
          { p: 'Teatro, artes visuales y música son parte importante de nuestra propuesta.' },
          { p: 'A través del arte, los alumnos encuentran nuevas maneras de expresarse, descubren talentos, desarrollan su creatividad y ganan confianza para compartir sus ideas y mostrarse como son.' },
          { quote: 'Educar también es darles espacio para descubrir aquello que los hace únicos.' },
        ],
      },
      {
        title: 'Una escuela donde cada alumno importa',
        blocks: [
          { p: 'La cercanía es una de nuestras mayores fortalezas.' },
          { p: 'Nuestros maestros conocen a sus alumnos, saben qué necesitan y acompañan de cerca tanto su desarrollo académico como personal. Además, reciben capacitación constante porque sabemos que enseñar bien también significa seguir aprendiendo.' },
          { p: 'Y este acompañamiento no termina en el salón de clases. Mantenemos una comunicación cercana con las familias porque creemos que **cuando escuela y familia trabajan juntas, los alumnos tienen mejores oportunidades para crecer.**' },
        ],
      },
      {
        title: 'Excelencia académica con calidad humana',
        blocks: [
          { p: 'Promovemos que nuestros alumnos terminen la Secundaria con una excelente preparación académica y listos para enfrentar con seguridad la siguiente etapa. Pero queremos algo más: queremos jóvenes curiosos, responsables, creativos y seguros de sí mismos; capaces de pensar, expresar lo que sienten y sus ideas, convivir con los demás y tomar buenas decisiones.' },
          { quote: 'Porque una buena escuela prepara para el siguiente nivel. Una gran educación prepara para la vida.' },
        ],
      },
    ],
    photo: { src: '/assets/facade.webp', alt: 'Fachada del Colegio Interlaken', after: 4 },
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
