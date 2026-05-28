import { codeToHtml } from 'shiki'

export async function CodeBlock({
  code,
  lang = 'python',
}: {
  code: string
  lang?: string
}) {
  const html = await codeToHtml(code, {
    lang,
    theme: 'github-dark-default',
    transformers: [
      {
        pre(node) {
          // Strip Shiki's inline background so the surrounding card colour shows through.
          if (node.properties) {
            const style = (node.properties.style as string | undefined) ?? ''
            const cleaned = style
              .split(';')
              .map((s) => s.trim())
              .filter((s) => s && !s.startsWith('background-color'))
              .join('; ')
            node.properties.style = cleaned
            node.properties.class = [
              node.properties.class,
              'overflow-x-auto p-4 text-[12px] leading-relaxed font-mono',
            ].filter(Boolean).join(' ')
          }
        },
      },
    ],
  })

  return (
    <div
      className="rounded border border-border bg-[#0a0a0a] overflow-hidden"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
