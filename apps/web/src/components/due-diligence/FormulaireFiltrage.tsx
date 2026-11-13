"use client";

import { useState, type FormEvent } from "react";
import { NIVEAUX_ES } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminFiltrages,
  libellesDd,
  libelleTheme,
  messageDd,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChoixMultiple } from "./ChoixMultiple";

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
  const themes: SaisieTheme[] = saisieThemesVides().map((th) => {
    const connu = dernier?.themes.find((x) => x.code === th.code);
    return connu
      ? { code: th.code, niveau: connu.niveau, justification: connu.justification ?? "" }
      : th;
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
  const t = useT();
  const langue = useLangue();
  const optionsNiveauEs = optionsDe(NIVEAUX_ES, libellesDd(langue).NIVEAU_ES);
  const f = useFormulaire<ChampFiltrage>();
  const [s, setS] = useState<SaisieFiltrage>(() => saisieInitiale(dernier, parDefaut));
  const maj = (p: Partial<SaisieFiltrage>) => setS((x) => ({ ...x, ...p }));
  const majTheme = (code: string, p: Partial<SaisieTheme>) =>
    setS((x) => ({
      ...x,
      themes: x.themes.map((th) => (th.code === code ? { ...th, ...p } : th)),
    }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerFiltrage(s, langue),
      (charge) => api.post<{ id: string }>(cheminFiltrages(dossierId), charge),
      {
        succes: t(
          "Revue enregistrée : les règles touchées sont listées ci-dessus.",
          "Review saved: the rules hit are listed above.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        "Nouvelle revue environnementale et sociale",
        "New environmental and social review",
      )}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Revue refusée", "Review refused")}
      />
      {erreurListes ? (
        <Alerte
          tonalite="attention"
          titre={t("Listes d'exclusion indisponibles", "Exclusion lists unavailable")}
          annonce="aucune"
        >
          <p>{erreurListes}</p>
        </Alerte>
      ) : listes.length === 0 ? (
        <Alerte
          tonalite="info"
          titre={t("Aucune liste d'exclusion", "No exclusion list")}
          annonce="aucune"
        >
          <p>
            {t(
              "Aucune liste n'est définie pour le cabinet. Un expert peut en créer une depuis Paramètres, Due diligence, Listes d'exclusion.",
              "No list is defined for the firm. An expert can create one from Settings, Due diligence, Exclusion lists.",
            )}
          </p>
        </Alerte>
      ) : null}
      <Select
        libelle={t("Liste d'exclusion", "Exclusion list")}
        required
        invite={t("Choisir…", "Choose…")}
        options={listes.map((l) => ({
          valeur: l.id,
          libelle: t(
            `${l.nom} (${l.client_id ? (l.client_raison_sociale ?? "investisseur") : "générale"}, ${l.nb_regles} règle${l.nb_regles > 1 ? "s" : ""})`,
            `${l.nom} (${l.client_id ? (l.client_raison_sociale ?? "investor") : "general"}, ${l.nb_regles} rule${l.nb_regles > 1 ? "s" : ""})`,
          ),
        }))}
        value={s.liste_id}
        onChange={(e) => maj({ liste_id: e.target.value })}
        erreur={f.erreurs.liste_id}
        aide={t(
          "Générale ou propre à l'investisseur : la version courante de la liste est appliquée.",
          "General or specific to the investor: the current version of the list is applied.",
        )}
      />
      <ZoneTexte
        libelle={t("Activités de la cible", "Target's activities")}
        rows={4}
        value={s.activites}
        onChange={(e) => maj({ activites: e.target.value })}
        erreur={f.erreurs.activites}
        aide={t(
          "Une activité par ligne (30 au plus), par exemple « Exploitation d'une plantation de cacao ».",
          "One activity per line (30 at most), for example “Operating a cocoa plantation”.",
        )}
      />
      <div className="mp-grille-champs">
        <ChoixMultiple
          libelle={t("Secteurs déclarés", "Declared sectors")}
          options={optionsTaxonomie(secteurs)}
          valeurs={s.secteur_codes}
          onChange={(v) => maj({ secteur_codes: v })}
          erreur={f.erreurs.secteur_codes}
          libelleAjout={t("Ajouter le secteur", "Add the sector")}
        />
        <ChoixMultiple
          libelle={t("Pays déclarés", "Declared countries")}
          options={optionsTaxonomie(pays)}
          valeurs={s.pays_codes}
          onChange={(v) => maj({ pays_codes: v })}
          erreur={f.erreurs.pays_codes}
          libelleAjout={t("Ajouter le pays", "Add the country")}
        />
      </div>

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">
          {t("Huit thèmes de revue", "Eight review themes")}
        </legend>
        <p className="mp-champ__aide">
          {t(
            "Libellés propres à CabinetPilot, provisoires, à valider par un expert E&S. Cadre public cité en référence seulement : normes de performance de la SFI (aucun texte reproduit).",
            "Labels specific to CabinetPilot, provisional, to be validated by an E&S expert. Public framework cited as a reference only: IFC performance standards (no text reproduced).",
          )}
        </p>
        {f.erreurs.themes ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.themes}</p>
          </Alerte>
        ) : null}
        <div className="mp-themes-es">
          {s.themes.map((th) => (
            <div key={th.code} className="mp-theme-es">
              <Select
                libelle={libelleTheme(th.code, langue)}
                invite={t("Non évalué", "Not assessed")}
                options={optionsNiveauEs}
                value={th.niveau}
                onChange={(e) => majTheme(th.code, { niveau: e.target.value })}
              />
              {th.niveau !== "" ? (
                <ZoneTexte
                  libelle={`${t("Justification", "Justification")} : ${libelleTheme(th.code, langue)}`}
                  rows={2}
                  required={niveauEsExigeJustification(th.niveau)}
                  value={th.justification}
                  onChange={(e) => majTheme(th.code, { justification: e.target.value })}
                  aide={
                    niveauEsExigeJustification(th.niveau)
                      ? t("Obligatoire dès le niveau modéré.", "Required from the moderate level.")
                      : t("Facultative.", "Optional.")
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Analyse en cours…", "Analysis in progress…")}
        >
          {t("Lancer la revue", "Start the review")}
        </Bouton>
      </div>
    </form>
  );
}
