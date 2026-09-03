// The reader keeps book content separate from chat history.  A book is an
// ordered list of chapters and paragraph blocks, so an adapter can later
// replace this seed book with imported or server-provided content without
// changing the reading state machine.

export const READING_BOOKS = [
  {
    id: 'lily-garden-notes',
    title: '铃兰花园手记',
    author: '一本文字散步',
    description: '一段关于安静、记忆与重新出发的短篇阅读。',
    chapters: [
      {
        id: 'lily-chapter-1',
        title: '第一章 玻璃温室',
        paragraphs: [
          {
            id: 'lily-1-1',
            text: '清晨的光先落在温室的玻璃上，像有人从很远的地方递来一封没有署名的信。雾还没有完全散去，叶片的边缘挂着细小的水珠，风经过时，它们一颗一颗地往下走。',
          },
          {
            id: 'lily-1-2',
            text: '我把门推开一条缝，旧门轴发出很轻的声音。花园里没有人，石板路也没有昨夜的脚印，只有角落里那盏忘记熄灭的灯，把一小块潮湿的地面照得像月亮。',
          },
          {
            id: 'lily-1-3',
            text: '桌上放着一只蓝色的杯子。它并不特别，杯沿还有洗不掉的茶渍，可我每次看见它，都会想起有人曾经在这里坐过很久，什么也没有说，只把手掌贴在温暖的杯壁上。',
          },
          {
            id: 'lily-1-4',
            text: '园丁说，植物不怕安静，真正让它们枯萎的是没有人愿意等。于是我在靠窗的位置写下日期，又给最里面那盆铃兰浇了半壶水，仿佛这样就能把时间留在原处。',
          },
        ],
      },
      {
        id: 'lily-chapter-2',
        title: '第二章 一封未寄出的信',
        paragraphs: [
          {
            id: 'lily-2-1',
            text: '午后的雨来得突然，屋檐像一排细密的琴键。雨声把街道隔在外面，屋里只剩纸张翻动的声音。我找出一只旧木盒，里面没有宝物，只有几张写了一半的信和一枚失去光泽的邮票。',
          },
          {
            id: 'lily-2-2',
            text: '第一封信的开头是“如果你还记得这里”，后面却空了很长一段。那时我以为沉默是因为没有话可说，后来才明白，有些话正因为太重要，才会在落笔之前反复停顿。',
          },
          {
            id: 'lily-2-3',
            text: '我没有把信补完。人总会想替过去找一个漂亮的结尾，好像结尾写得足够好，离开就会变得合理。但真实的日子并不负责工整，它留下折痕，也留下没有寄出的地址。',
          },
          {
            id: 'lily-2-4',
            text: '雨停后，云层之间露出一小片浅蓝。我把纸重新折好，放回木盒，并在盒盖上写了一句新的话：今天也可以先照顾好自己。写完以后，房间没有变亮，却没有刚才那么空了。',
          },
        ],
      },
      {
        id: 'lily-chapter-3',
        title: '第三章 夜里的车站',
        paragraphs: [
          {
            id: 'lily-3-1',
            text: '车站在夜里显得比白天大。售票厅的灯一盏接一盏亮着，候车的人各自守着一点安静，行李箱的滚轮从地面划过，像一条短暂而清晰的线。',
          },
          {
            id: 'lily-3-2',
            text: '我坐在最靠近窗边的位置，看列车把远处的灯拆成一串又一串。广播念出站名时，声音里有一种不属于任何人的温柔，它不挽留谁，也不催促谁，只是提醒下一段路已经准备好了。',
          },
          {
            id: 'lily-3-3',
            text: '一个小女孩抱着睡着的猫，问她的父亲我们是不是一直都在往前走。父亲想了想，说有时候列车也会停下来，停下来不是忘了前进，而是让需要上车的人赶得上。',
          },
          {
            id: 'lily-3-4',
            text: '这句话在我心里停了一会儿。过去我总把暂停看成退后，把犹豫看成软弱，仿佛只有不停向前才配得到一个新的明天。可那晚的车站告诉我，停下也可以是一种抵达。',
          },
        ],
      },
      {
        id: 'lily-chapter-4',
        title: '第四章 风从花园来',
        paragraphs: [
          {
            id: 'lily-4-1',
            text: '几天以后，花园里的铃兰终于开了。花朵很小，低着头，白色的钟形花瓣藏在叶子之间，必须靠得很近才能看清。它们没有急着证明自己，却把整个角落变得清澈。',
          },
          {
            id: 'lily-4-2',
            text: '我把那只蓝色的杯子洗干净，放到窗台上。风从半开的窗里进来，带着泥土、青草和一点雨后的凉意。桌上的纸张被吹动，未寄出的信露出一角，又安静地落回原处。',
          },
          {
            id: 'lily-4-3',
            text: '我们常常以为记得一个地方，就必须把那里的一切保存下来。其实记忆更像花园里的风，它会带走一些，也会把别处的种子带来。留下来的不是原样，而是某一天忽然愿意继续生活的心情。',
          },
          {
            id: 'lily-4-4',
            text: '傍晚时我关上温室的门，没有锁。明天还会有新的水珠落在玻璃上，新的脚步经过石板路，也许有人会端起那只杯子，在这里坐很久。花园不再等待过去，它只是把灯留着，等风把下一页翻开。',
          },
        ],
      },
    ],
  },
]

export const DEFAULT_READING_BOOK_ID = READING_BOOKS[0].id
export const READING_CHARS_PER_PAGE = 800

export function flattenBook(book) {
  if (!book) return []
  const blocks = []
  let pageNumber = 1
  let pageChars = 0
  book.chapters.forEach((chapter, chapterIndex) => {
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      const globalIndex = blocks.length
      const paragraphChars = Math.max(1, String(paragraph.text || '').replace(/\s/g, '').length)
      if (pageChars > 0 && pageChars + paragraphChars > READING_CHARS_PER_PAGE) {
        pageNumber += 1
        pageChars = 0
      }
      blocks.push({
        ...paragraph,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterIndex,
        paragraphIndex,
        globalIndex,
        pageNumber,
        pageId: `${book.id}-page-${pageNumber}`,
        order: chapterIndex * 10000 + paragraphIndex,
      })
      pageChars += paragraphChars
    })
  })
  return blocks
}

export function countBookCharacters(book) {
  return flattenBook(book).reduce((total, paragraph) => (
    total + paragraph.text.replace(/\s/g, '').length
  ), 0)
}

export function createInitialReadingState(book = READING_BOOKS[0]) {
  const first = flattenBook(book)[0]
  return {
    bookId: book?.id || DEFAULT_READING_BOOK_ID,
    status: 'idle',
    currentChapterId: first?.chapterId || null,
    currentParagraphId: first?.id || null,
    currentPageId: first?.pageId || null,
    currentPage: first?.pageNumber || 1,
    nextParagraphId: null,
    activeSessionId: null,
    readParagraphIds: [],
    progressChars: 0,
    lastReadAt: null,
    speed: 'normal',
    highlights: [],
    annotations: [],
    readingLog: [],
    actionCache: {},
    completionReason: '',
    activity: '等 AI 翻开这一页',
    pauseReason: '',
    error: '',
  }
}
