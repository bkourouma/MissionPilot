"use client";

import { useState, type FormEvent } from "react";
import { NIVEAUX_ES } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminFiltrages,
  libelleTheme,
  messageDd,
  NIVEAU_ES_LIBELLES,
  optionsDe,
  type EntreeTaxonomie,
  type FiltrageDd,
  type ListeExclusion,
} from "../../lib/due-diligence";
import {
  niveauEsExigeJustification,
  saisieThemesVides,
  validerFiltrage,
  type ChampFiltrage,
  type SaisieFiltrage,
  type SaisieTheme,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChoixMultiple } from "./ChoixMultiple";

const OPTIONS_NIVEAU_ES = optionsDe(NIVEAUX_ES, NIVEAU_ES_LIBELLES);
const optionsTaxonomie = (entrees: readonly EntreeTaxonomie[]) =>
  entrees.map((e) => ({ valeur: e.code, libelle: e.libelle }));

export interface FormulaireFiltrageProps {
  dossierId: string;
  listes: ListeExclusion[];
  erreurListes: string | null;
  secteurs: EntreeTaxonomie[];
  pays: EntreeTaxonomie[];
  /** Dernier filtrage : préremplit la nouvelle revue (la dernière fait foi). */
  dernier: FiltrageDd | null;
  /** Secteur et pays du cadrage du dossier, proposés par défaut pour la première revue. */
  parDefaut: { secteur_code: string; pays_code: string };
}

function saisieInitiale(
  dernier: FiltrageDd | null,
  parDefaut: FormulaireFiltrageProps["parDefaut"],
): SaisieFiltrage {
  const themes: SaisieTheme[] = saisieThemesVides().map((t) => {
    const connu = dernier?.themes.find((x) => x.code === t.code);
    return connu
      ? { code: t.code, niveau: connu.niveau, justification: connu.justification ?? "" }
      : t;
  });
  return {
    liste_id: "",
    activites: dernier?.declarations.activites.join("\n") ?? "",
    secteur_codes: dernier ? dernier.declarations.secteur_codes : [parDefaut.secteur_code],
    pays_codes: dernier ? dernier.declarations.pays_codes : [parDefaut.pays_code],
    themes,
  };
}

/**
 * Revue environnementale et sociale (DD-14) : choix de la liste d'exclusion, activités de la cible,
 * secteurs et pays déclarés, et niveau de chacun des huit thèmes. Le moteur recherche les règles
 * touchées (mots-clés par préfixe : des faux positifs sont possibles, tranchés par un valideur).
 */
export function FormulaireFiltrage({
  dossierId,
  listes,
  erreurListes,
  secteurs,
  pays,
  dernier,
  parDefaut,
}: FormulaireFiltrageProps) {
  const f = useFormulaire<ChampFiltrage>();
  const [s, setS] = useState<SaisieFiltrage>(() => saisieInitiale(dernier, parDefaut));
  const maj = (p: Partial<SaisieFiltrage>) => setS((x) => ({ ...x, ...p }));
  const majTheme = (code: string, p: Partial<SaisieTheme>) =>
    setS((x) => ({ ...x, themes: x.themes.map((t) => (t.code === code ? { ...t, ...p } : t)) }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerFiltrage(s),
      (charge) => api.post<{ id: string }>(cheminFiltrages(dossierId), charge),
      {
        succes: "Revue enregistrée : les règles touchées sont listées ci-dessus.",
        messageSpecifique: messageDd,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvelle revue environnementale et sociale"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Revue refusée"
      />
      {erreurListes ? (
        <Alerte tonalite="attention" titre="Listes d'exclusion indisponibles" annonce="aucune">
          <p>{erreurListes}</p>
        </Alerte>
      ) : listes.length === 0 ? (
        <Alerte tonalite="info" titre="Aucune liste d'exclusion" annonce="aucune">
          <p>
            Aucune liste n&apos;est définie pour le cabinet. Un expert peut en créer une depuis
            Paramètres, Due diligence, Listes d&apos;exclusion.
          </p>
        </Alerte>
      ) : null}
      <Select
        libelle="Liste d'exclusion"
        required
        invite="Choisir…"
        options={listes.map((l) => ({
          valeur: l.id,
          libelle: `${l.nom} (${l.client_id ? (l.client_raison_sociale ?? "investisseur") : "générale"}, ${l.nb_regles} règle${l.nb_regles > 1 ? "s" : ""})`,
        }))}
        value={s.liste_id}
        onChange={(e) => maj({ liste_id: e.target.value })}
        erreur={f.erreurs.liste_id}
        aide="Générale ou propre à l'investisseur : la version courante de la liste est appliquée."
      />
      <ZoneTexte
        libelle="Activités de la cible"
        rows={4}
        value={s.activites}
        onChange={(e) => maj({ activites: e.target.value })}
        erreur={f.erreurs.activites}
        aide="Une activité par ligne (30 au plus), par exemple « Exploitation d'une plantation de cacao »."
      />
      <div className="mp-grille-champs">
        <ChoixMultiple
          libelle="Secteurs déclarés"
          options={optionsTaxonomie(secteurs)}
          valeurs={s.secteur_codes}
          onChange={(v) => maj({ secteur_codes: v })}
          erreur={f.erreurs.secteur_codes}
          libelleAjout="Ajouter le secteur"
        />
        <ChoixMultiple
          libelle="Pays déclarés"
          options={optionsTaxonomie(pays)}
          valeurs={s.pays_codes}
          onChange={(v) => maj({ pays_codes: v })}
          erreur={f.erreurs.pays_codes}
          libelleAjout="Ajouter le pays"
        />
      </div>

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Huit thèmes de revue</legend>
        <p className="mp-champ__aide">
          Libellés propres à CabinetPilot, provisoires, à valider par un expert E&amp;S. Cadre
          public cité en référence seulement : normes de performance de la SFI (aucun texte
          reproduit).
        </p>
        {f.erreurs.themes ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.themes}</p>
          </Alerte>
        ) : null}
        <div className="mp-themes-es">
          {s.themes.map((t) => (
            <div key={t.code} className="mp-theme-es">
              <Select
                libelle={libelleTheme(t.code)}
                invite="Non évalué"
                options={OPTIONS_NIVEAU_ES}
                value={t.niveau}
                onChange={(e) => majTheme(t.code, { niveau: e.target.value })}
              />
              {t.niveau !== "" ? (
                <ZoneTexte
                  libelle={`Justification : ${libelleTheme(t.code)}`}
                  rows={2}
                  required={niveauEsExigeJustification(t.niveau)}
                  value={t.justification}
                  onChange={(e) => majTheme(t.code, { justification: e.target.value })}
                  aide={
                    niveauEsExigeJustification(t.niveau)
                      ? "Obligatoire dès le niveau modéré."
                      : "Facultative."
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Analyse en cours…">
          Lancer la revue
        </Bouton>
      </div>
    </form>
  );
}
