import { defineSkill } from 'eve/skills'
import { publishedSkill } from '../lib/published-skill'

export default defineSkill(publishedSkill('analyze-logs'))
