/** The landing page's marketing copy. */
import { defineMessages } from '@/i18n/messages';

interface Feature {
  title: string;
  /** the keyboard card takes the shortcut in this device's spelling and the other platform's ("⌘K on a Mac") */
  body: string | ((keys: string, other: string) => string);
}

export const landingMessages = defineMessages(
  {
    mainNav: 'Main',
    navFeatures: 'Features',
    navHow: 'How it works',
    navTemplates: 'Templates',
    navLearn: 'Learn',
    openApp: 'Open the app',
    badgeNew: 'New',
    badgeText: 'Learning map: hands-on Terraform lessons with XP and badges',
    heroTitle: 'Design cloud infrastructure visually.',
    heroAccent: 'Ship Terraform instantly.',
    heroBody:
      'The blueprint editor that keeps your architecture diagram and your Terraform code in perfect sync, for AWS, Azure and GCP. Free, open source, and it runs entirely in your browser.',
    // the two doors
    doors: 'Choose how to start',
    doorBuild: 'Build my infrastructure',
    doorBuildBody: 'Draw it or write HCL: the diagram and the code stay in sync.',
    doorLearn: 'Learn Terraform',
    doorLearnBody: 'A gamified map from your first block to a real AWS network.',
    openDemo: 'Open live demo',
    orDemo: 'or open the live demo',
    trust: 'No account · No server · MIT licensed',
    // hero demo
    clickResource: 'Click a resource',
    liveSync: 'Live two-way sync',
    subtitleOnDemand: 'on-demand',
    subtitleRole: 'IAM role',
    subtitleQueue: 'queue',
    // stats
    statServices: 'cloud services',
    statTemplates: 'production templates',
    statClouds: 'clouds, one canvas',
    statServers: 'servers or accounts',
    /** the same shortcut on the other platform */
    keysOn: { mac: (keys: string) => `${keys} on a Mac`, pc: (keys: string) => `${keys} on Windows and Linux` },
    // features
    featuresEyebrow: 'Features',
    featuresTitleBefore: 'Everything you need to go from whiteboard to ',
    features: {
      sync: {
        title: 'Truly bidirectional',
        body: 'Drag a resource and the HCL writes itself. Type Terraform and the diagram rebuilds. Comments and formatting survive every round-trip.',
      },
      clouds: {
        title: '100+ services, three clouds',
        body: 'AWS, Azure and GCP in one palette (from VPCs and Lambdas to AKS, Pub/Sub and Key Vault), with real nesting and connection rules.',
      },
      keyboard: {
        title: 'Keyboard-first',
        body: (keys: string, other: string) =>
          `Press ${keys} (${other}) to add resources, jump anywhere or run any action. Double-click the canvas to drop a service right where you want it.`,
      },
      layout: {
        title: 'One-click tidy layout',
        body: 'A layered auto-layout that understands containers: messy imports become a clean, readable architecture in a second.',
      },
      import: {
        title: 'Bring your own Terraform',
        body: 'Drop existing .tf files, a folder or a .zip. The diagram draws itself from the references already in your code.',
      },
      export: {
        title: 'Export everything',
        body: 'Download a ready-to-apply Terraform zip, a crisp PNG/SVG of the diagram, or share the whole project as a link.',
      },
      private: {
        title: 'Private by design',
        body: 'No account, no server, no tracking. Projects live in your browser; share links keep the data in the URL fragment.',
      },
      diagnostics: {
        title: 'Diagnostics as you type',
        body: 'Unclosed blocks, missing required arguments and dangling references are flagged instantly, on the canvas and in the code.',
      },
    } satisfies Record<string, Feature>,
    // how it works
    howEyebrow: 'How it works',
    howTitle: 'Three steps. No yak shaving.',
    steps: [
      { title: 'Start anywhere', body: 'Pick a template, import your .tf files, or open a blank canvas.' },
      { title: 'Design both ways', body: 'Drag, connect and nest on the canvas, or just write HCL. Both stay in sync.' },
      { title: 'Ship it', body: 'Export the Terraform and run terraform apply. Diagram included.' },
    ] as Array<{ title: string; body: string }>,
    // the learning map
    learnEyebrow: 'Learning map',
    learnTitle: 'Learn Terraform by building it',
    learnBody:
      'Short lessons on AWS, from zero. You write the code, the canvas draws it live and a simulated terminal runs it: no account, no bill.',
    learnPoints: [
      { title: 'Four levels', body: 'Fundamentals, first resources, networking, then compute and security, each with a challenge.' },
      { title: 'XP, ranks and badges', body: 'Every lesson earns XP. Keep a daily streak and climb from Newcomer to Cloud Engineer.' },
      { title: 'A terminal you can’t break', body: 'Run init, plan, apply and destroy against a simulator. Nothing touches a real cloud.' },
      { title: 'Start where you are', body: 'New to AWS? We explain it. Know it already? Go straight to Terraform.' },
    ] as Array<{ title: string; body: string }>,
    openMap: 'Open the learning map',
    mapLabel: 'A level of the learning map: three lessons done, one in progress, its badge at the end',
    badgeUnlocked: 'Badge unlocked',
    // templates
    templatesEyebrow: 'Templates',
    templatesTitle: 'Start from a proven pattern',
    browseAll: (n: number) => `Browse all ${n}`,
    useTemplate: 'Use template',
    // call to action
    ctaTitle: 'Your next architecture is one drag away.',
    ctaBody: 'Open the editor, pick a template and export real Terraform in minutes. No sign-up.',
    startBuilding: 'Start building',
    starOnGithub: 'Star on GitHub',
    footer: 'Free & open source · MIT license · Built with React Flow, Monaco and a lot of HCL',
  },
  {
    mainNav: 'Principal',
    navFeatures: 'Funcionalidades',
    navHow: 'Como funciona',
    navTemplates: 'Templates',
    navLearn: 'Aprender',
    openApp: 'Abrir o app',
    badgeNew: 'Novo',
    badgeText: 'Mapa de aprendizado: lições práticas de Terraform com XP e conquistas',
    heroTitle: 'Desenhe sua nuvem.',
    heroAccent: 'Gere o Terraform na hora.',
    heroBody:
      'O editor de blueprints que mantém o diagrama da sua arquitetura e o código Terraform em sincronia perfeita, para AWS, Azure e GCP. Gratuito, open source e roda inteiramente no seu navegador.',
    doors: 'Escolha como começar',
    doorBuild: 'Criar minha infraestrutura',
    doorBuildBody: 'Desenhe ou escreva HCL: o diagrama e o código ficam em sincronia.',
    doorLearn: 'Aprender Terraform',
    doorLearnBody: 'Um mapa gamificado do seu primeiro bloco até uma rede AWS de verdade.',
    openDemo: 'Abrir a demo',
    orDemo: 'ou abra a demo',
    trust: 'Sem conta · Sem servidor · Licença MIT',
    clickResource: 'Clique em um recurso',
    liveSync: 'Sincronia bidirecional',
    subtitleOnDemand: 'sob demanda',
    subtitleRole: 'perfil do IAM',
    subtitleQueue: 'fila',
    statServices: 'serviços de nuvem',
    statTemplates: 'templates prontos para produção',
    statClouds: 'nuvens, um só canvas',
    statServers: 'servidores ou contas',
    keysOn: { mac: (keys: string) => `${keys} no Mac`, pc: (keys: string) => `${keys} no Windows e no Linux` },
    featuresEyebrow: 'Funcionalidades',
    featuresTitleBefore: 'Tudo o que você precisa para ir do quadro branco ao ',
    features: {
      sync: {
        title: 'Bidirecional de verdade',
        body: 'Arraste um recurso e o HCL se escreve sozinho. Digite Terraform e o diagrama se refaz. Comentários e formatação sobrevivem a cada ida e volta.',
      },
      clouds: {
        title: '100+ serviços, três nuvens',
        body: 'AWS, Azure e GCP em uma só paleta (de VPCs e Lambdas a AKS, Pub/Sub e Key Vault), com aninhamento real e regras de conexão.',
      },
      keyboard: {
        title: 'Feito para o teclado',
        body: (keys: string, other: string) =>
          `Pressione ${keys} (${other}) para adicionar recursos, ir a qualquer lugar ou executar qualquer ação. Clique duas vezes no canvas para soltar um serviço exatamente onde quiser.`,
      },
      layout: {
        title: 'Layout organizado em um clique',
        body: 'Um layout automático em camadas que entende contêineres: importações bagunçadas viram uma arquitetura limpa e legível em um segundo.',
      },
      import: {
        title: 'Traga seu próprio Terraform',
        body: 'Solte arquivos .tf existentes, uma pasta ou um .zip. O diagrama se desenha sozinho a partir das referências que já estão no seu código.',
      },
      export: {
        title: 'Exporte tudo',
        body: 'Baixe um .zip de Terraform pronto para aplicar, um PNG/SVG nítido do diagrama ou compartilhe o projeto inteiro como um link.',
      },
      private: {
        title: 'Privado por padrão',
        body: 'Sem conta, sem servidor, sem rastreamento. Os projetos ficam no seu navegador; os links de compartilhamento guardam os dados no fragmento da URL.',
      },
      diagnostics: {
        title: 'Diagnóstico enquanto você digita',
        body: 'Blocos não fechados, argumentos obrigatórios ausentes e referências soltas são apontados na hora, no canvas e no código.',
      },
    },
    howEyebrow: 'Como funciona',
    howTitle: 'Três passos. Sem enrolação.',
    steps: [
      { title: 'Comece de onde quiser', body: 'Escolha um template, importe seus arquivos .tf ou abra um canvas em branco.' },
      {
        title: 'Projete nos dois sentidos',
        body: 'Arraste, conecte e aninhe no canvas, ou simplesmente escreva HCL. Os dois ficam em sincronia.',
      },
      { title: 'Coloque no ar', body: 'Exporte o Terraform e rode terraform apply. Diagrama incluso.' },
    ],
    learnEyebrow: 'Mapa de aprendizado',
    learnTitle: 'Aprenda Terraform construindo',
    learnBody:
      'Lições curtas na AWS, do zero. Você escreve o código, o canvas desenha ao vivo e um terminal simulado o executa: sem cadastro e sem fatura.',
    learnPoints: [
      { title: 'Quatro níveis', body: 'Fundamentos, primeiros recursos, rede, depois computação e segurança, cada um com um desafio.' },
      { title: 'XP, patentes e conquistas', body: 'Cada lição dá XP. Mantenha a sequência diária e suba de Iniciante a Engenheiro de nuvem.' },
      { title: 'Um terminal que não quebra', body: 'Rode init, plan, apply e destroy em um simulador. Nada toca uma nuvem de verdade.' },
      { title: 'Comece de onde você está', body: 'Novo na AWS? A gente explica. Já conhece? Vá direto ao Terraform.' },
    ],
    openMap: 'Abrir o mapa de aprendizado',
    mapLabel: 'Um nível do mapa de aprendizado: três lições concluídas, uma em andamento e a conquista no fim',
    badgeUnlocked: 'Conquista desbloqueada',
    templatesEyebrow: 'Templates',
    templatesTitle: 'Comece de um padrão comprovado',
    browseAll: (n: number) => `Ver todos os ${n}`,
    useTemplate: 'Usar template',
    ctaTitle: 'Sua próxima arquitetura começa com um simples arrastar.',
    ctaBody: 'Abra o editor, escolha um template e exporte Terraform de verdade em minutos. Sem cadastro.',
    startBuilding: 'Começar a criar',
    starOnGithub: 'Dê uma estrela no GitHub',
    footer: 'Gratuito e open source · Licença MIT · Feito com React Flow, Monaco e muito HCL',
  },
);
