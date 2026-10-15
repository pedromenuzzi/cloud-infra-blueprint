import { argSet, has, noErrors, ran } from '../goals';
import type { Lesson } from '../types';
import { aws } from './shared';

export const lessons: Lesson[] = [
  {
    slug: 'first-resource',
    code: '0.2',
    kind: 'lesson',
    mode: 'canvas',
    minutes: 6,
    xp: 40,
    title: { en: 'Your first resource', pt: 'Seu primeiro recurso' },
    summary: {
      en: 'Add an S3 bucket from the palette and read the block it writes.',
      pt: 'Adicione um bucket S3 pela paleta e leia o bloco que ele escreve.',
    },
    body: [
      {
        en: 'The code already has two blocks: `terraform` says which provider to download, and `provider "aws"` says which region to talk to. Neither creates anything, which is why the canvas is empty.',
        pt: 'O código já tem dois blocos: `terraform` diz qual provider baixar, e `provider "aws"` diz com qual região conversar. Nenhum dos dois cria nada, por isso o canvas está vazio.',
      },
      {
        en: 'A `resource` block is something Terraform creates. Drag an *S3 bucket* from the palette onto the canvas and watch the block appear in the code.',
        pt: 'Um bloco `resource` é algo que o Terraform cria. Arraste um *bucket S3* da paleta para o canvas e veja o bloco aparecer no código.',
      },
    ],
    asides: [
      {
        title: { en: 'What is S3?', pt: 'O que é o S3?' },
        body: [
          {
            en: 'S3 is AWS storage for files of any size. A bucket is a named container for those files.',
            pt: 'O S3 é o armazenamento de arquivos da AWS, de qualquer tamanho. Um bucket é um contêiner com nome para esses arquivos.',
          },
        ],
        awsBasics: true,
      },
    ],
    start: aws(),
    solution: aws(`resource "aws_s3_bucket" "assets" {
  bucket = "my-first-bucket-123"
}
`),
    goals: [
      {
        id: 'bucket',
        text: { en: 'An S3 bucket on the canvas', pt: 'Um bucket S3 no canvas' },
        hint: {
          en: 'Find *S3 bucket* in the palette (search for "s3") and drag it onto the canvas.',
          pt: 'Procure *bucket S3* na paleta (busque por "s3") e arraste para o canvas.',
        },
        test: has('aws_s3_bucket'),
      },
      {
        id: 'name',
        text: { en: 'The bucket has a `bucket` name', pt: 'O bucket tem um nome em `bucket`' },
        hint: {
          en: 'Select the bucket and fill in *bucket* in the inspector, or type `bucket = "a-unique-name"` inside the block.',
          pt: 'Selecione o bucket e preencha *bucket* no inspector, ou digite `bucket = "a-unique-name"` dentro do bloco.',
        },
        test: argSet('aws_s3_bucket', 'bucket'),
      },
      {
        id: 'valid',
        text: { en: 'The code is valid', pt: 'O código é válido' },
        hint: {
          en: 'Look for the red marks in the code panel: every `{` needs its `}` and every text value its quotes.',
          pt: 'Procure as marcas vermelhas no painel de código: todo `{` precisa do seu `}` e todo texto, das aspas.',
        },
        test: noErrors,
      },
      {
        id: 'plan',
        text: { en: 'Run `terraform plan`', pt: 'Rode `terraform plan`' },
        hint: {
          en: 'In the terminal, run `init` first and then `plan`: it lists what would be created.',
          pt: 'No terminal, rode `init` primeiro e depois `plan`: ele lista o que seria criado.',
        },
        test: ran('plan'),
      },
    ],
    teaches: ['aws_s3_bucket'],
  },
];
