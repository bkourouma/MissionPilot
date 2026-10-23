import {
  RED_STATUT_CLOTURE_DOSSIER_LIBELLES,
  RED_STATUTS_ACTION,
  type RedClotureDossierResume,
  type RedTableauCausesVue,
  type RedTableauCreanciersVue,
  type RedTableauPlanVue,
  type RedTableauSuiviVue,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import { libelleStatutAction } from "../../lib/redressement";
import {
  libelleNombre,
  TEXTE_CAUSES_NON_VALIDEES,
  TEXTE_CAUSES_PLUS_RECENTE,
} from "../../lib/redressement-tableau";
import { BadgeStatut } from "../ui/BadgeStatut";
import { TableauListe } from "./TableauBloc";

/** Plan d'actions : répartition par statut et actions en retard (comptes fournis par l'API). */
export function TableauPlan({ p }: { p: RedTableauPlanVue }) {
  return (
    <TableauListe
      lignes={[
        ...RED_STATUTS_ACTION.map(
          (s) => [libelleStatutAction(s), libelleNombre(p.actions_par_statut[s] ?? 0)] as const,
        ),
        ["Actions en retard", libelleNombre(p.en_retard)],
        [
          "Version du plan",
          p.version_courante === null
            ? "Aucune version"
            : `Version ${libelleNombre(p.version_courante)}`,
        ],
        [
          "Modifié depuis la validation",
          p.modifie_depuis_validation ? "Oui, à faire valider de nouveau" : "Non",
        ],
      ]}
    />
  );
}

/** Créanciers : nombre, encours et échu totaux (déjà additionnés par l'API). */
export function TableauCreanciers({ c, devise }: { c: RedTableauCreanciersVue; devise: Devise }) {
  return (
    <TableauListe
      lignes={[
        ["Nombre de créanciers", libelleNombre(c.nombre)],
        ["Encours total", formaterMontantMineur(c.encours_total, devise)],
        ["Dont échu", formaterMontantMineur(c.echu_total, devise)],
      ]}
    />
  );
}

/** Causes racines : une proposition non validée est présentée comme telle, jamais comme acquise. */
export function TableauCauses({ c }: { c: RedTableauCausesVue }) {
  const validee = c.statut === "validee";
  return (
    <div className="mp-pile">
      <p>
        <BadgeStatut tonalite={validee ? "succes" : "attention"}>
          {validee ? "Validée par un expert" : "Proposition à valider"}
        </BadgeStatut>
      </p>
      {validee ? null : <p className="mp-texte-doux">{TEXTE_CAUSES_NON_VALIDEES}</p>}
      <TableauListe
        lignes={[
          ["Version", `Version ${libelleNombre(c.version)}`],
          ...(validee
            ? ([
                ["Validée le", c.valide_le ? formaterDate(c.valide_le) : "—"],
                ["Causes retenues", libelleNombre(c.nombre_causes)],
              ] as const)
            : []),
        ]}
      />
      {c.version_plus_recente_non_validee && validee ? (
        <p className="mp-texte-doux">{TEXTE_CAUSES_PLUS_RECENTE}</p>
      ) : null}
    </div>
  );
}

/** Bilan de clôture : statut, version et date de validation. */
export function TableauCloture({ c }: { c: RedClotureDossierResume }) {
  return (
    <TableauListe
      lignes={[
        ["Statut du bilan", RED_STATUT_CLOTURE_DOSSIER_LIBELLES[c.statut] ?? c.statut],
        ["Version", c.version === null ? "—" : `Version ${libelleNombre(c.version)}`],
        ["Validé le", c.valide_le ? formaterDate(c.valide_le) : "—"],
      ]}
    />
  );
}

/** Suivi après mission : nombre d'alertes et points d'attention. */
export function TableauSuivi({ s }: { s: RedTableauSuiviVue }) {
  return (
    <TableauListe
      lignes={[
        ["Alertes de suivi", libelleNombre(s.nombre)],
        ["Dont points d'attention", libelleNombre(s.attention)],
      ]}
    />
  );
}
