"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton, classesBouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Icone } from "../../../../components/ui/Icone";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import { messageQuestionnaire, type VersionDetail } from "../../../../lib/questionnaires";
import { suggererIdentifiant } from "../../../../lib/questionnaires-definition";
import {
  LONGUEURS_GENERATION_IA,
  SAISIE_GENERATION_IA_VIDE,
  validerGenerationIa,
  type ChampGenerationIa,
  type SaisieGenerationIa,
} from "../../../../lib/questionnaires-ia";

/**
 * Besoin du consultant (service, population, thème) → brouillon IA. Les termes sensibles
 * (noms propres, sigles du client) sont masqués avant l'envoi au fournisseur, en plus des
 * formats connus (e-mails, téléphones).
 */
export function FormulaireGenerationIa() {
  const router = useRouter();
  const f = useFormulaire<ChampGenerationIa>();
  const [s, setS] = useState<SaisieGenerationIa>(SAISIE_GENERATION_IA_VIDE);
  const [codeSaisi, setCodeSaisi] = useState(false);

  /** Code proposé à partir du thème tant que l'utilisateur ne l'a pas saisi lui-même. */
  const maj = (patch: Partial<SaisieGenerationIa>) =>
    setS((x) => {
      const suivant = { ...x, ...patch };
      return codeSaisi || patch.theme === undefined
        ? suivant
        : { ...suivant, code: suggererIdentifiant(suivant.theme) };
    });

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerGenerationIa(s),
      (charge) => api.post<VersionDetail>("/api/questionnaires/generation-ia", charge),
      {
        rafraichir: false,
        messageSpecifique: messageQuestionnaire,
        apres: (v) => router.push(`/questionnaires/versions/${v.id}`),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Génération impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Service du cabinet"
          name="service"
          required
          maxLength={LONGUEURS_GENERATION_IA.service}
          value={s.service}
          erreur={f.erreurs.service}
          aide="Ex. « Diagnostic de compétitivité »."
          onChange={(e) => maj({ service: e.target.value })}
        />
        <Champ
          libelle="Population interrogée"
          name="population"
          required
          maxLength={LONGUEURS_GENERATION_IA.population}
          value={s.population}
          erreur={f.erreurs.population}
          aide="Ex. « Dirigeants de PME agroalimentaires »."
          onChange={(e) => maj({ population: e.target.value })}
        />
        <Champ
          libelle="Thème"
          name="theme"
          required
          maxLength={LONGUEURS_GENERATION_IA.theme}
          value={s.theme}
          erreur={f.erreurs.theme}
          aide="Ce que le questionnaire doit explorer, ex. « Pilotage de la production »."
          onChange={(e) => maj({ theme: e.target.value })}
        />
        <Champ
          libelle="Nombre de questions (au plus)"
          name="nombre_questions"
          type="number"
          inputMode="numeric"
          required
          value={s.nombre_questions}
          erreur={f.erreurs.nombre_questions}
          onChange={(e) => maj({ nombre_questions: e.target.value })}
        />
        <Champ
          libelle="Code du modèle"
          name="code"
          required
          maxLength={80}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={s.code}
          erreur={f.erreurs.code}
          aide="Identifiant stable, unique dans le cabinet : minuscules sans accent, chiffres, « _ », « . » ou « - »."
          onChange={(e) => {
            setCodeSaisi(e.target.value !== "");
            setS((x) => ({ ...x, code: e.target.value }));
          }}
        />
      </div>
      <ZoneTexte
        libelle="Termes à masquer (facultatif)"
        name="termes_sensibles"
        rows={3}
        value={s.termes_sensibles}
        erreur={f.erreurs.termes_sensibles}
        aide="Noms de personnes, d'entreprises ou sigles à ne pas transmettre au fournisseur d'IA : un par ligne. Les e-mails et numéros de téléphone sont masqués automatiquement."
        onChange={(e) => maj({ termes_sensibles: e.target.value })}
      />
      <p className="mp-indice mp-texte-doux mp-texte-petit">
        <Icone nom="info" taille={16} />
        <span>
          La version 1 est créée en brouillon IA et s&apos;ouvre dans l&apos;éditeur. Les questions
          sont des propositions : aucun chiffre n&apos;est produit par l&apos;IA.
        </span>
      </p>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement="Génération en cours…"
        >
          Générer le brouillon
        </Bouton>
        <Link href="/questionnaires" className={classesBouton("secondaire")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
