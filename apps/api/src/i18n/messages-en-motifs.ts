/**
 * Motifs des messages à partie variable (version anglaise). Les plus spécifiques d'abord ; le
 * motif générique « … introuvable. » reste à la fin de `messages-en.ts`. Chaque groupe capturé est
 * traduit par `traduireMessage` s'il figure dans `MESSAGES_EN` (sinon il reste tel quel).
 */
export type MotifEn = readonly [RegExp, (...groupes: string[]) => string];

export const MOTIFS_SPECIFIQUES_EN: ReadonlyArray<MotifEn> = [
  // Plafonds et fenêtres de débit
  [
    /^(\d+) lignes au plus par état financier\.$/,
    (n) => `At most ${n} lines per financial statement.`,
  ],
  [
    /^Agrégats masqués : au moins (\d+) participants requis pour une synthèse\.$/,
    (n) => `Aggregates hidden: at least ${n} participants are required for a summary.`,
  ],
  [
    /^Au plus (\d+) déclarations par compétence et par collaborateur\.$/,
    (n) => `At most ${n} declarations per skill and per staff member.`,
  ],
  [
    /^Au plus (\d+) dossiers de revue par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} review files per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) états financiers par dossier\.$/,
    (n) => `At most ${n} financial statements per file.`,
  ],
  [
    /^Au plus (\d+) exports de CV par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} CV exports per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) valeurs de facteurs par dossier\.$/,
    (n) => `At most ${n} factor values per file.`,
  ],
  [/^Au plus (\d+) faits par dossier\.$/, (n) => `At most ${n} facts per file.`],
  [
    /^Au plus (\d+) messages par (\d+) minutes au copilote : réessayez plus tard\.$/,
    (n, m) => `At most ${n} messages per ${m} minutes to the copilot: try again later.`,
  ],
  [
    /^Au plus (\d+) enregistrements de détention par cabinet\.$/,
    (n) => `At most ${n} shareholding records per firm.`,
  ],
  [
    /^Au plus (\d+) PDF de factures par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} invoice PDFs per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) propositions de portefeuille par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} portfolio proposals per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) rapports par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} reports per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) recherches par minute : réessayez dans un instant\.$/,
    (n) => `At most ${n} searches per minute: try again in a moment.`,
  ],
  [
    /^Au plus (\d+) cartographies de causes racines par dossier\.$/,
    (n) => `At most ${n} root cause maps per file.`,
  ],
  [
    /^Au plus (\d+) rejeux par plan et par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} replays per plan per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) consultations du brief par (\d+) minutes : réessayez dans quelques instants\.$/,
    (n, m) => `At most ${n} brief views per ${m} minutes: try again in a few moments.`,
  ],
  [
    /^Au plus (\d+) dépôts par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} deposits per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) simulations par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `At most ${n} simulations per ${m} minutes: try again later.`,
  ],
  [
    /^Au plus (\d+) automatisations actives par cabinet : désactivez-en une avant d'en activer une autre\.$/,
    (n) => `At most ${n} active automations per firm: disable one before enabling another.`,
  ],
  [
    /^Au plus (\d+) versions d'une même contribution\.$/,
    (n) => `At most ${n} versions of the same contribution.`,
  ],
  [
    /^Au plus (\d+) (.+) par 10 minutes : réessayez plus tard\.$/,
    (n, quoi) => `At most ${n} ${quoi} per 10 minutes: try again later.`,
  ],
  [
    /^Brouillon trop long pour une revue \((\d+) caractères au plus\)\.$/,
    (n) => `Draft too long for a review (${n} characters at most).`,
  ],
  [
    /^Cette analyse est limitée à (\d+) demandes par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `This analysis is limited to ${n} requests per ${m} minutes: try again later.`,
  ],
  [
    /^Cette action est limitée à (\d+) demandes par (\d+) minutes : réessayez plus tard\.$/,
    (n, m) => `This action is limited to ${n} requests per ${m} minutes: try again later.`,
  ],
  [
    /^Cette mission atteint le plafond de (\d+) éléments pour ce registre\.$/,
    (n) => `This engagement reaches the cap of ${n} items for this register.`,
  ],
  [
    /^Cette pièce compte déjà (\d+) dépôts : le cabinet doit en retirer ou la rejeter avant un nouveau dépôt\.$/,
    (n) =>
      `This document already has ${n} deposits: the firm must withdraw some or reject it before a new deposit.`,
  ],
  [
    /^Le cabinet a déjà (\d+) modèles : archivez-en avant d'en créer\.$/,
    (n) => `The firm already has ${n} templates: archive some before creating one.`,
  ],
  [
    /^Le cabinet compte (\d+) gabarits de CV au plus\.$/,
    (n) => `The firm may have at most ${n} CV templates.`,
  ],
  [
    /^Le cabinet compte déjà (\d+) guichets : désactivez ou réutilisez un guichet existant\.$/,
    (n) => `The firm already has ${n} windows: disable or reuse an existing window.`,
  ],
  [
    /^Le volume de dépôts de cette demande \((\d+) Mo\) est atteint : contactez le cabinet\.$/,
    (n) => `The deposit volume for this request (${n} MB) has been reached: contact the firm.`,
  ],
  [
    /^Le cabinet a atteint (\d+) documents lus en 24 heures : réessayez plus tard\.$/,
    (n) => `The firm has reached ${n} documents read in 24 hours: try again later.`,
  ],
  [/^Facteurs du cabinet : (\d+) au plus\.$/, (n) => `Firm factors: ${n} at most.`],
  [/^(.+) : (\d+) au plus par version\.$/, (quoi, n) => `${quoi}: ${n} at most per version.`],
  [
    /^Fichier trop volumineux : (\d+(?:[.,]\d+)?) Mo au plus\.$/,
    (n) => `File too large: ${n} MB at most.`,
  ],
  [
    /^L'arbre d'hypothèses ne dépasse pas (\d+) niveaux\.$/,
    (n) => `The hypothesis tree does not exceed ${n} levels.`,
  ],
  [/^L'import est limité à (\d+) lignes\.$/, (n) => `The import is limited to ${n} rows.`],
  [
    /^L'évaluation dépasserait (\d+) périodes : choisissez une date d'arrêté plus proche du début du suivi ou réduisez le nombre de KPI suivis\.$/,
    (n) =>
      `The evaluation would exceed ${n} periods: choose a cutoff date closer to the start of tracking or reduce the number of tracked KPIs.`,
  ],
  [
    /^La chaîne d'héritage dépasse (\d+) maillons\.$/,
    (n) => `The inheritance chain exceeds ${n} links.`,
  ],
  [
    /^La discipline se calcule sur (\d+) semaines au plus\.$/,
    (n) => `Discipline is calculated over ${n} weeks at most.`,
  ],
  [
    /^La matrice compte (\d+) exigences au plus\.$/,
    (n) => `The matrix has ${n} requirements at most.`,
  ],
  [
    /^Plafond atteint : (\d+) décisions par filtrage au plus\.$/,
    (n) => `Limit reached: ${n} decisions per filtering at most.`,
  ],
  [
    /^Plafond atteint : (\d+) événements de liens par hypothèse au plus\.$/,
    (n) => `Limit reached: ${n} link events per hypothesis at most.`,
  ],
  [
    /^Plafond atteint : (\d+) changements de l'option au plus\.$/,
    (n) => `Limit reached: ${n} changes to the option at most.`,
  ],
  [
    /^Plafond atteint : (\d+) invitations au plus\.$/,
    (n) => `Limit reached: ${n} invitations at most.`,
  ],
  [
    /^Plafond atteint : (\d+) publications au plus\.$/,
    (n) => `Limit reached: ${n} publications at most.`,
  ],
  [/^Plafond atteint : (\d+) versions au plus\.$/, (n) => `Limit reached: ${n} versions at most.`],
  [/^Plafond atteint : (\d+) (.+) au plus\.$/, (n, quoi) => `Limit reached: ${n} ${quoi} at most.`],
  [
    /^Plus de (\d+) missions éligibles : affinez les critères \(période, types, directeurs\)\.$/,
    (n) => `More than ${n} eligible engagements: refine the criteria (period, types, directors).`,
  ],
  [
    /^Quota de (\d+) générations IA par jour atteint : réessayez demain\.$/,
    (n) => `Daily quota of ${n} AI generations reached: try again tomorrow.`,
  ],
  [
    /^Un commentaire se modifie dans les (\d+) minutes suivant sa publication\.$/,
    (n) => `A comment can be edited within ${n} minutes of its publication.`,
  ],
  [
    /^Un exercice compte au plus (\d+) re-prévisions\.$/,
    (n) => `A fiscal year has at most ${n} reforecasts.`,
  ],
  [/^Un plan compte au plus (\d+) éléments\.$/, (n) => `A plan has at most ${n} items.`],
  [
    /^Un plan compte au plus (\d+) projets et jalons\.$/,
    (n) => `A plan has at most ${n} projects and milestones.`,
  ],
  [
    /^Un plan compte au plus (\d+) versions du modèle financier\.$/,
    (n) => `A plan has at most ${n} financial model versions.`,
  ],
  [
    /^Un trimestre compte au plus (\d+) versions de réalisé\.$/,
    (n) => `A quarter has at most ${n} actuals versions.`,
  ],
  [
    /^Un verdict qui s'écarte de l'indication du moteur exige un motif détaillé \((\d+) caractères au moins\)\.$/,
    (n) =>
      `A verdict that departs from the engine's indication requires a detailed reason (at least ${n} characters).`,
  ],
  [
    /^Une affectation couvre au plus (\d+) jours\.$/,
    (n) => `An assignment covers at most ${n} days.`,
  ],
  [
    /^Une date d'effet antérieure de plus de (\d+) jours à aujourd'hui exige un commentaire qui la justifie\.$/,
    (n) =>
      `An effective date more than ${n} days before today requires a comment that justifies it.`,
  ],
  [/^Une demande compte au plus (\d+) pièces\.$/, (n) => `A request has at most ${n} documents.`],
  [/^Une fiche compte (\d+) dossiers au plus\.$/, (n) => `A record has at most ${n} files.`],
  [
    /^Une fiche compte (\d+) extractions au plus\.$/,
    (n) => `A record has at most ${n} extractions.`,
  ],
  [/^Une mission compte au plus (\d+) KPI\.$/, (n) => `An engagement has at most ${n} KPIs.`],
  [
    /^Une mission compte au plus (\d+) demandes\.$/,
    (n) => `An engagement has at most ${n} requests.`,
  ],
  [
    /^Une transcription compte (\d+) versions au plus : validez ou rejetez-la\.$/,
    (n) => `A transcription has ${n} versions at most: approve or reject it.`,
  ],
  [/^Une tâche porte au plus (\d+) affectations\.$/, (n) => `A task has at most ${n} assignments.`],
  [
    /^Personne à relancer : un destinataire ne se relance pas deux fois en moins de (\d+) h\.$/,
    (n) => `Nobody to remind: a recipient is not reminded twice within ${n} h.`,
  ],
  [
    /^Un répondant ne se relance pas deux fois en moins de (\d+) h\.$/,
    (n) => `A respondent is not reminded twice within ${n} h.`,
  ],
  [
    /^Le plan de charge couvre (\d+) semaines au plus par requête\.$/,
    (n) => `The workload plan covers ${n} weeks at most per request.`,
  ],
  [
    /^Classeur refusé : plus de (\d+) éléments dans l'archive\.$/,
    (n) => `Workbook refused: more than ${n} items in the archive.`,
  ],
  [/^Classeur refusé : (\d+) feuilles au plus\.$/, (n) => `Workbook refused: ${n} sheets at most.`],
  [
    /^Classeur refusé : (\d+) colonnes renseignées au plus\.$/,
    (n) => `Workbook refused: ${n} populated columns at most.`,
  ],

  // Saisie des temps
  [
    /^(.+) : le cabinet saisit les temps en heures\.$/,
    (q) => `${q}: the firm records time in hours.`,
  ],
  [
    /^(.+) : le cabinet saisit les temps en jours \(pas de 0,5\)\.$/,
    (q) => `${q}: the firm records time in days (steps of 0.5).`,
  ],
  [
    /^(.+) : les heures doivent correspondre à des minutes entières\.$/,
    (q) => `${q}: hours must correspond to whole minutes.`,
  ],
  [
    /^(.+) : les temps se saisissent à la demi-journée \(pas de 0,5\)\.$/,
    (q) => `${q}: time is entered in half-days (steps of 0.5).`,
  ],
  [
    /^(.+) : utilisateur inconnu ou sans le rôle requis\.$/,
    (q) => `${q}: user unknown or without the required role.`,
  ],
  [
    /^(\d+) feuille\(s\) de temps de ce mois ne sont pas validées : les faire valider ou rejeter avant la clôture\.$/,
    (n) =>
      `${n} timesheet(s) for this month are not approved: have them approved or rejected before close-out.`,
  ],
  [/^Capacité journalière dépassée : (.+)\.$/, (m) => `Daily capacity exceeded: ${m}.`],
  [
    /^Le (.+) : une même case dépasse 24 heures ou 3 jours\.$/,
    (d) => `On ${d}: a single cell exceeds 24 hours or 3 days.`,
  ],
  [
    /^Ligne (\d+) : la date (.+) est hors de la semaine de la feuille\.$/,
    (i, d) => `Row ${i}: the date ${d} is outside the timesheet's week.`,
  ],
  [
    /^Ligne (\d+) : la tâche « (.+) » n'est pas affectée à ce collaborateur\.$/,
    (i, t) => `Row ${i}: the task "${t}" is not assigned to this staff member.`,
  ],
  [
    /^Ligne (\d+) : reste à faire hors du pas de saisie du cabinet\.$/,
    (i) => `Row ${i}: remaining work is outside the firm's entry step.`,
  ],
  [
    /^Ligne (\d+) : tâche inconnue dans cette mission\.$/,
    (i) => `Row ${i}: task unknown in this engagement.`,
  ],
  [/^Ligne (.+) : (.+)\.$/, (i, m) => `Row ${i}: ${m}.`],
  [
    /^La tâche « (.+) » ne vous est pas affectée : saisie refusée\. Demandez une affectation au chef de mission\.$/,
    (t) =>
      `The task "${t}" is not assigned to you: entry refused. Ask the engagement manager for an assignment.`,
  ],
  [
    /^La tâche « (.+) » sortirait des dates de la mission\.$/,
    (t) => `The task "${t}" would fall outside the engagement's dates.`,
  ],
  [
    /^La mission de la tâche « (.+) » est clôturée\.$/,
    (t) => `The engagement of the task "${t}" is closed.`,
  ],
  [
    /^La période commence avant la mission \((.+)\)\.$/,
    (d) => `The period starts before the engagement (${d}).`,
  ],
  [
    /^La période se termine après la mission \((.+)\)\.$/,
    (d) => `The period ends after the engagement (${d}).`,
  ],
  [
    /^La période doit rester dans celle de la tâche \(du (.+) au (.+)\)\.$/,
    (a, b) => `The period must stay within the task's (from ${a} to ${b}).`,
  ],
  [
    /^Une feuille de temps existe déjà pour la semaine du (.+)\.$/,
    (s) => `A timesheet already exists for the week of ${s}.`,
  ],
  [
    /^Période de temps clôturée \((.+)\) : passer par une demande de correction\.$/,
    (d) => `Closed time period (${d}): submit a correction request.`,
  ],
  [/^Période clôturée : (.+)\.$/, (d) => `Closed period: ${d}.`],
  [
    /^Le budget signé prévoit (.+) j (.+) ; (.+) j seraient alloués\. Créer une révision du budget\.$/,
    (b, quoi, a) =>
      `The signed budget provides ${b} d ${quoi}; ${a} d would be allocated. Create a budget revision.`,
  ],
  [
    /^Les jours alloués sur la tâche \((.+) j\) dépassent son budget \((.+) j\)\.$/,
    (a, b) => `The days allocated on the task (${a} d) exceed its budget (${b} d).`,
  ],
  [
    /^Les jours alloués au grade « (.+) » sur la tâche \((.+) j\) dépassent son budget \((.+) j\)\.$/,
    (g, a, b) =>
      `The days allocated to grade "${g}" on the task (${a} d) exceed its budget (${b} d).`,
  ],

  // Facturation et finance
  [
    /^Cette baisse de l'échéancier \(écart au budget signé\) est décidée par (.+)\.$/,
    (r) =>
      `This reduction of the payment schedule (variance from the signed budget) is decided by ${r}.`,
  ],
  [/^Cette facture est approuvée par (.+)\.$/, (r) => `This invoice is approved by ${r}.`],
  [
    /^Cette révision doit être validée par : (.+)\.$/,
    (r) => `This revision must be approved by: ${r}.`,
  ],
  [
    /^Corrections négatives sur la période du (.+) : traiter l'écart par un avoir\.$/,
    (p) => `Negative corrections for the period of ${p}: handle the difference with a credit note.`,
  ],
  [
    /^Coût type en (.+), plan en (.+) : saisir le budget de l'initiative\.$/,
    (a, b) => `Standard cost in ${a}, plan in ${b}: enter the initiative's budget.`,
  ],
  [
    /^Coûts en (.+) non convertibles en (.+) sans taux figé\.$/,
    (a, b) => `Costs in ${a} cannot be converted into ${b} without a fixed rate.`,
  ],
  [
    /^Encaissement antérieur à l'émission de la facture (.*) : l'enregistrer en avance\.$/,
    (n) => `Payment received predates the issue of invoice ${n}: record it as an advance.`,
  ],
  [/^Facture (.*) non émise ou annulée\.$/, (n) => `Invoice ${n} not issued or canceled.`],
  [
    /^La facture (.*) est celle d'un autre client\.$/,
    (n) => `Invoice ${n} belongs to another client.`,
  ],
  [/^La facture (.*) est dans une autre devise\.$/, (n) => `Invoice ${n} is in another currency.`],
  [
    /^L'imputation dépasse le reste à payer de la facture (.*) \(trop-perçu refusé\)\.$/,
    (n) => `The allocation exceeds the remaining amount due on invoice ${n} (overpayment refused).`,
  ],
  [
    /^L'échéance « (.+) » n'est pas à facturer\.$/,
    (e) => `The installment "${e}" is not to be invoiced.`,
  ],
  [
    /^Le débours « (.+) » n'est pas un débours refacturable validé\.$/,
    (d) => `The expense "${d}" is not an approved rebillable expense.`,
  ],
  [
    /^Le taux (.+) → (.+) est saisi par un associé ou un gestionnaire\.$/,
    (a, b) => `The ${a} → ${b} rate is entered by a partner or a manager.`,
  ],
  [
    /^Parité fixe (.+) → (.+) \((.+)\) : aucun autre taux n'est accepté\.$/,
    (a, b, f) => `Fixed parity ${a} → ${b} (${f}): no other rate is accepted.`,
  ],
  [
    /^Taux de change (.+) → (.+) requis à la signature\.$/,
    (a, b) => `Exchange rate ${a} → ${b} required at signing.`,
  ],
  [
    /^Taux de change hors bornes \((.+) à (.+)\)\.$/,
    (a, b) => `Exchange rate out of bounds (${a} to ${b}).`,
  ],
  [
    /^Taux de vente différents de la proposition validée : (.+)\.$/,
    (l) => `Selling rates differ from the approved proposal: ${l}.`,
  ],
  [/^Taux de vente manquant\(s\) : (.+)\.$/, (l) => `Missing selling rate(s): ${l}.`],
  [
    /^Taux de TVA non autorisé par le cabinet \((.+)\)\.$/,
    (l) => `VAT rate not allowed by the firm (${l}).`,
  ],
  [
    /^Un débours se saisit dans la devise de la mission \((.+)\)\.$/,
    (d) => `An expense is entered in the engagement's currency (${d}).`,
  ],
  [
    /^Mentions légales du cabinet à compléter avant émission : (.+)\.$/,
    (l) => `Firm legal notices to complete before issuing: ${l}.`,
  ],
  [/^Pièce (.*) déséquilibrée : export refusé\.$/, (p) => `Entry ${p} unbalanced: export refused.`],
  [/^Un e-mail de relance a déjà été envoyé/, () => "A reminder email has already been sent."],
  [
    /^Modèle non disponible : (.+)\. Choisissez un modèle au tarif connu \((.+)\)\.$/,
    (m, l) => `Model not available: ${m}. Choose a model with a known rate (${l}).`,
  ],

  // Plans, notation, méthodes, standard
  [
    /^Brique « (.+) » : l'autonomie (.+) dépasse celle du standard \((.+)\)\.$/,
    (b, n, s) => `Building block "${b}": autonomy ${n} exceeds the standard's (${s}).`,
  ],
  [
    /^Brique « (.+) » : la classe (.+) abaisse celle du standard \((.+)\)\.$/,
    (b, c, s) => `Building block "${b}": class ${c} lowers the standard's (${s}).`,
  ],
  [
    /^Brique « (.+) » de classe (.+) : autonomie (.+) au plus\.$/,
    (b, c, m) => `Building block "${b}" of class ${c}: autonomy ${m} at most.`,
  ],
  [
    /^Cas « (.+) » inconnu de la session ou niveau hors échelle\.$/,
    (c) => `Case "${c}" unknown in the session or level out of scale.`,
  ],
  [
    /^Cette étape n'est pas requise pour la classe (.+)\.$/,
    (c) => `This step is not required for class ${c}.`,
  ],
  [
    /^Clôture impossible : la check-list comporte des items bloquants \((.+)\)\.$/,
    (l) => `Close-out impossible: the checklist has blocking items (${l}).`,
  ],
  [/^Colonnes manquantes : (.+)\.$/, (l) => `Missing columns: ${l}.`],
  [/^Colonnes manquantes dans l'en-tête : (.+)\.$/, (l) => `Missing columns in the header: ${l}.`],
  [
    /^Contexte invalide \(contexte\.(.+)\) : le type déclaré \((.+)\) n'est pas celui du facteur \((.+)\)\.$/,
    (f, a, b) =>
      `Invalid context (contexte.${f}): the declared type (${a}) is not the factor's (${b}).`,
  ],
  [/^Contexte invalide \((.*)\) : (.+)$/, (c, m) => `Invalid context (${c}): ${m}`],
  [
    /^Deux règles pondèrent la dimension « (.+) » : le comité méthode doit trancher\.$/,
    (d) => `Two rules weight the dimension "${d}": the method committee must decide.`,
  ],
  [
    /^Dimension inconnue pour cette mission : (.+)\.$/,
    (l) => `Dimension unknown for this engagement: ${l}.`,
  ],
  [
    /^Fixez d'abord le prix fixe du service « (.+) » : son type de mission ne peut pas être activé sans prix\.$/,
    (s) =>
      `Set the fixed price of the service "${s}" first: its engagement type cannot be enabled without a price.`,
  ],
  [
    /^Gains annuels : exactement (.+) valeurs attendues\.$/,
    (n) => `Annual gains: exactly ${n} values expected.`,
  ],
  [
    /^Grade\(s\) inconnu\(s\) dans ce cabinet : (.+)\.$/,
    (l) => `Grade(s) unknown in this firm: ${l}.`,
  ],
  [
    /^Indice de confiance (.+) sous le seuil du cabinet \((.+)\) : complétez les réponses, les répondants ou les preuves avant de publier\.$/,
    (i, s) =>
      `Confidence index ${i} is below the firm's threshold (${s}): complete the responses, respondents, or evidence before publishing.`,
  ],
  [
    /^Jeu d'essai refusé : une variable est insérée dans les consignes du prompt \((.+)\)\.$/,
    (l) => `Test set refused: a variable is inserted in the prompt's instructions (${l}).`,
  ],
  [
    /^L'action exige le champ « (.+) », absent de cet événement\.$/,
    (c) => `The action requires the field "${c}", which is missing from this event.`,
  ],
  [
    /^L'étape « (.+) » ne contient aucune brique\.$/,
    (e) => `The step "${e}" contains no building block.`,
  ],
  [
    /^La classe d'un livrable de ce type ne peut pas être inférieure à (.+)\.$/,
    (c) => `The class of a deliverable of this type cannot be lower than ${c}.`,
  ],
  [
    /^La clé d'une ligne « (.+) » commence par « (.+): »\.$/,
    (n) => `The key of a "${n}" line starts with "${n}:".`,
  ],
  [
    /^La définition de terminé n'est pas satisfaite \((.+) item\(s\) bloquant\(s\)\)\.$/,
    (n) => `The definition of done is not satisfied (${n} blocking item(s)).`,
  ],
  [
    /^La page (.+) n'existe pas dans le document\.$/,
    (p) => `Page ${p} does not exist in the document.`,
  ],
  [
    /^Le cas type « (.+) » ne donne pas le résultat attendu\.$/,
    (c) => `The test case "${c}" does not give the expected result.`,
  ],
  [
    /^Le gabarit cite « \{\{(.+)\}\} », champ inconnu de cet événement\.$/,
    (v) => `The template cites "{{${v}}}", a field unknown to this event.`,
  ],
  [
    /^Le prompt « (.+) » sert la tâche (.+)\.$/,
    (p, t) => `The prompt "${p}" serves the task ${t}.`,
  ],
  [
    /^Le rang (\d+) de l'échantillon diffère du tirage rejoué\.$/,
    (n) => `Rank ${n} of the sample differs from the replayed draw.`,
  ],
  [
    /^Le résumé cite un nombre introuvable dans la page (.+)\.$/,
    (p) => `The summary cites a number that cannot be found on page ${p}.`,
  ],
  [
    /^Les pondérations de contexte de la méthode rendent la grille invalide \((.+)\)\.$/,
    (c) => `The method's context weightings make the grid invalid (${c}).`,
  ],
  [
    /^Les trimestres se saisissent dans l'ordre, sans trou : saisir d'abord le trimestre (.+)\.$/,
    (t) => `Quarters are entered in order, with no gaps: enter quarter ${t} first.`,
  ],
  [/^Moteur inconnu : (.+)\.$/, (m) => `Engine unknown: ${m}.`],
  [
    /^Motif requis : ce contexte active ou retire une brique de classe R2 ou R3 \(([\s\S]+)\)\.$/,
    (l) =>
      `Reason required: this context enables or removes a class R2 or R3 building block (${l}).`,
  ],
  [
    /^Parcourez d'abord tous les éléments obligatoires de la revue \((.+) restant\(s\) sur (.+)\)\.$/,
    (r, t) => `Review all the mandatory items of the review first (${r} remaining out of ${t}).`,
  ],
  [
    /^Passage de « (.+) » à « (.+) » non admis\.$/,
    (a, b) => `Change from "${a}" to "${b}" not allowed.`,
  ],
  [
    /^Proposition de standard invalide(?: \((.+)\))?\.$/,
    (c) => (c ? `Invalid standard proposal (${c}).` : "Invalid standard proposal."),
  ],
  [/^Publication refusée : (.+) \((.*)\)\.$/, (m, c) => `Publication refused: ${m} (${c}).`],
  [/^Refusée par la garde : (.+)\.$/, (l) => `Refused by the guard: ${l}.`],
  [
    /^Seul un expert métier (.+) \(NOT-07\) : faites relire par un expert du cabinet\.$/,
    (a) => `Only a subject-matter expert can ${a} (NOT-07): have a firm expert review it.`,
  ],
  [/^Source inconnue ou inaccessible : (.+)\.$/, (s) => `Source unknown or inaccessible: ${s}.`],
  [/^Transition impossible : (.+) → (.+)\.$/, (a, b) => `Transition not possible: ${a} → ${b}.`],
  [
    /^Un appel d'offres porte déjà la référence « (.+) » : aucune fiche n'a été créée\.$/,
    (r) => `A tender already has the reference "${r}": no record was created.`,
  ],
  [
    /^Un facteur de contexte s'enrichit sans rien retirer : valeurs conservées, bornes élargies\.(?: (.+))?$/,
    (d) =>
      `A context factor can only be extended, never reduced: values kept, bounds widened.${d ? ` ${d}` : ""}`,
  ],
  [
    /^Une action « (.+) » ne peut pas passer à « (.+) »\.$/,
    (a, b) => `An action "${a}" cannot change to "${b}".`,
  ],
  [
    /^Une décision « (.+) » ne peut pas passer à « (.+) »\.$/,
    (a, b) => `A decision "${a}" cannot change to "${b}".`,
  ],
  [
    /^Une décision a été prise : le niveau de risque retenu ne descend plus sous « (.+) »\.$/,
    (n) => `A decision has been made: the selected risk level can no longer drop below "${n}".`,
  ],
  [/^Variable manquante : (.+)\.$/, (n) => `Missing variable: ${n}.`],
  [/^Variables fiables inconnues : (.+)\.$/, (l) => `Unknown trusted variables: ${l}.`],
  [/^Variables inconnues : (.+)\.$/, (l) => `Unknown variables: ${l}.`],
  [/^Variables manquantes : (.+)\.$/, (l) => `Missing variables: ${l}.`],
  [/^Variables non fiables inconnues : (.+)\.$/, (l) => `Unknown untrusted variables: ${l}.`],
  [
    /^« (.+) » n'est pas un item bloquant actif du modèle\.$/,
    (c) => `"${c}" is not an active blocking item of the template.`,
  ],
  [/^Fichier attendu dans le champ « (.+) »\.$/, (c) => `File expected in the field "${c}".`],
  [/^Bancabilité : (.+)$/, (d) => `Bankability: ${d}`],
  [
    /^(\d+) ligne\(s\) en erreur : rien n'a été ingéré\.$/,
    (n) => `${n} row(s) with errors: nothing was ingested.`,
  ],
  [
    /^(.+) n'a pas accès à l'élément lié\.$/,
    (n) => `${n} does not have access to the linked item.`,
  ],
  [
    /^(.+) n'a pas accès à cet élément : mention impossible\.$/,
    (n) => `${n} does not have access to this item: mention not possible.`,
  ],

  // Copilote
  [
    /^Ce commentaire fait (\d+) caractères : le copilote en accepte (\d+) au plus, pour que vous puissiez relire le texte entier avant de confirmer\. Raccourcissez-le, ou utilisez l'écran de la mission\.$/,
    (n, m) =>
      `This comment is ${n} characters long: the copilot accepts ${m} at most, so that you can read the whole text before confirming. Shorten it, or use the engagement screen.`,
  ],
  [
    /^Plusieurs missions correspondent à « (.*) » : précisez laquelle \((.*)\)\.$/,
    (q, l) => `Several engagements match "${q}": specify which one (${l}).`,
  ],
  [
    /^Le commentaire a été ajouté à la mission « (.*) »\.$/,
    (m) => `The comment was added to the engagement "${m}".`,
  ],
  [
    /^Aucune facture échue visible ne correspond à « (.*) »\. Indiquez son numéro exact\.$/,
    (q) => `No visible overdue invoice matches "${q}". Give its exact number.`,
  ],
  [
    /^La facture (.+) n'est pas échue ou est soldée : aucune relance n'est nécessaire\.$/,
    (n) => `Invoice ${n} is not overdue or is settled: no reminder is needed.`,
  ],
  [
    /^Une relance a déjà été enregistrée aujourd'hui pour la facture (.+) : réessayez demain\.$/,
    (n) => `A reminder has already been recorded today for invoice ${n}: try again tomorrow.`,
  ],
  [
    /^La relance de niveau (.+) de la facture (.+) a été enregistrée\. Aucun e-mail n'a été envoyé au client\.$/,
    (l, n) => `Level ${l} reminder for invoice ${n} was recorded. No email was sent to the client.`,
  ],
  [
    /^Je ne trouve aucun collaborateur correspondant à « (.*) »\.$/,
    (q) => `I cannot find any staff member matching "${q}".`,
  ],
  [
    /^Plusieurs collaborateurs correspondent à « (.*) » : précisez le nom complet \((.*)\)\.$/,
    (q, l) => `Several staff members match "${q}": specify the full name (${l}).`,
  ],
  [/^La tâche « (.*) » a été créée\.$/, (t) => `The task "${t}" was created.`],

  // Agents, automatisation, qualité
  [
    /^Promotion refusée : critères non remplis \((.+)\)\.$/,
    (l) => `Promotion refused: criteria not met (${l}).`,
  ],
  [
    /^Classe de risque inférieure au plancher de la méthode pour cette brique \((.+)\)\.$/,
    (p) => `Risk class below the method's floor for this building block (${p}).`,
  ],
  [/^Garde non respectée : (.+)\.$/, (l) => `Guard not satisfied: ${l}.`],
  [
    /^Statut du contenu « (.+) » ; attendu : (.+)\.$/,
    (s, a) => `Content status "${s}"; expected: ${a}.`,
  ],
  [/^Palier de relance inconnu : (.+)\.$/, (p) => `Reminder tier unknown: ${p}.`],
  [/^Deux lignes portent la clé « (.+) »\.$/, (c) => `Two lines have the key "${c}".`],
  [
    /^Classeur protégé par mot de passe ou au format Excel 97-2003 \(\.xls\) : enregistrer une copie au format \.xlsx sans mot de passe\.$/,
    () =>
      "Password-protected workbook or Excel 97-2003 (.xls) format: save a copy in .xlsx format without a password.",
  ],

  // Messages écrits sur plusieurs lignes dans le code
  [
    /^Ce compte est protégé par la double authentification : la connexion rapide ne la contourne pas\. Connectez-vous avec l'adresse e-mail et le mot de passe\.$/,
    () =>
      "This account is protected by two-factor authentication: quick sign-in does not bypass it. Sign in with your email address and password.",
  ],
  [
    /^Le demandeur ou l'auteur d'une version d'une offre ne la valide pas lui-même : demandez à un autre utilisateur ou à un associé\.$/,
    () =>
      "The requester or author of a version of a bid does not approve it themselves: ask another user or a partner.",
  ],
  [
    /^Une section contient encore un repère du gabarit à rédiger ou à adapter : complétez l'offre dans une nouvelle version avant de la valider\.$/,
    () =>
      "A section still contains a template placeholder to write or adapt: complete the bid in a new version before approving it.",
  ],
  [
    /^Un agent qui lit du contenu client ne reçoit pas les chiffres dans ses consignes : placez \{\{chiffres\}\} dans le message utilisateur\.$/,
    () =>
      "An agent that reads client content does not receive the figures in its instructions: place {{chiffres}} in the user message.",
  ],
  [
    /^Exécution refusée : la version active du prompt n'a pas réussi le dernier jeu d'essai avec le modèle de sa tâche\.$/,
    () =>
      "Run refused: the active prompt version did not pass the latest test set with its task's model.",
  ],
  [
    /^Une feuille de temps a été créée pendant l'import pour l'une de ces semaines : rien n'a été importé, relancer la simulation\.$/,
    () =>
      "A timesheet was created during the import for one of these weeks: nothing was imported, rerun the simulation.",
  ],
  [
    /^La brique « (.+) » n'est pas confiée à l'agent contradicteur : un responsable doit la déclarer \(niveau d'autonomie, coupe-circuit\) avant la première revue\.$/,
    (b) =>
      `The building block "${b}" is not assigned to the adversarial agent: a manager must declare it (autonomy level, circuit breaker) before the first review.`,
  ],
];
