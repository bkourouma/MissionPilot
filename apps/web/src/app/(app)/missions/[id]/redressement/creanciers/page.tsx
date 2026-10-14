import Link from "next/link";
import type { Metadata } from "next";
import type { RedCreanciersVue } from "@missionpilot/shared";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { FormulaireCreancier } from "../../../../../../components/redressement/FormulaireCreancier";
import { ListeCreanciers } from "../../../../../../components/redressement/ListeCreanciers";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate, formaterMontantMineur } from "../../../../../../lib/format";
import { aujourdhui as aujourdhuiIso } from "../../../../../../lib/periode";
import {
  BANDEAU_CONFIDENTIALITE,
  cheminCreanciers,
  formaterPart,
  hrefRedressement,
  raisonSansEcriture,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Créanciers du redressement" };

type FiltreActifs = "true" | "false" | "tous";

const FILTRES: { valeur: FiltreActifs; libelle: string }[] = [
  { valeur: "true", libelle: "Actifs" },
  { valeur: "false", libelle: "Inactifs" },
  { valeur: "tous", libelle: "Tous" },
];

function lireActifs(v: string | string[] | undefined): FiltreActifs {
  const brut = Array.isArray(v) ? v[0] : v;
  return brut === "false" || brut === "tous" ? brut : "true";
}

/**
 * Registre des créanciers (RED-12) : total dû, dont échu, part garantie, concentration des trois
 * plus gros (synthèse du moteur), liste, ajout d'un créancier. Les conditions négociées sont
 * confidentielles et absentes du journal d'audit.
 */
export default async function PageCreanciers({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const actifs = lireActifs((await searchParams).actifs);
  const base = hrefRedressement(id, "creanciers");
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return <EtatContexteRed contexte={ctx} missionId={id} hrefReessayer={base} />;
  }
  const { mission, dossier, droits } = ctx;
  const r = await chargerServeur<RedCreanciersVue>(cheminCreanciers(dossier.id, actifs));
  const m = (v: number) => formaterMontantMineur(v, dossier.devise);

  return (
    <div className="mp-red">
      <Alerte tonalite="info" annonce="aucune">
        <p>{BANDEAU_CONFIDENTIALITE}</p>
      </Alerte>

      {!r.ok ? (
        <EtatErreur
          titre="Le registre des créanciers n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={base}
        />
      ) : (
        <>
          <div className="mp-red-cartes">
            <Carte titre="Total dû" niveauTitre={3}>
              <p className="mp-red-chiffre mp-red-valeur">{m(r.donnees.synthese.total_encours)}</p>
            </Carte>
            <Carte titre="Dont échu" niveauTitre={3}>
              <p className="mp-red-chiffre mp-red-valeur">{m(r.donnees.synthese.total_echu)}</p>
            </Carte>
            <Carte titre="Part garantie" niveauTitre={3}>
              <p className="mp-red-chiffre">{formaterPart(r.donnees.synthese.part_garantie_pb)}</p>
            </Carte>
            <Carte titre="Concentration des trois plus gros" niveauTitre={3}>
              <p className="mp-red-chiffre">
                {formaterPart(r.donnees.synthese.concentration_top3_pb)}
              </p>
              <p className="mp-texte-doux mp-texte-petit">
                Situation au {formaterDate(r.donnees.date_reference)}.
              </p>
            </Carte>
          </div>

          <nav aria-label="Filtrer les créanciers" className="mp-filtre-segments">
            {FILTRES.map((f) => (
              <Link
                key={f.valeur}
                href={f.valeur === "true" ? base : `${base}?actifs=${f.valeur}`}
                className="mp-bouton mp-bouton--discret"
                aria-current={f.valeur === actifs ? "true" : undefined}
              >
                {f.libelle}
              </Link>
            ))}
          </nav>

          {r.donnees.elements.length === 0 ? (
            <EtatVide titre="Aucun créancier enregistré." icone="dossier">
              <p>Aucun créancier enregistré.</p>
            </EtatVide>
          ) : (
            <ListeCreanciers missionId={id} elements={r.donnees.elements} devise={dossier.devise} />
          )}
        </>
      )}

      {droits.ecrire ? (
        <Carte titre="Ajouter un créancier">
          <FormulaireCreancier
            dossierId={dossier.id}
            devise={dossier.devise}
            aujourdhui={aujourdhuiIso()}
          />
        </Carte>
      ) : (
        <p className="mp-texte-doux">
          {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles)}
        </p>
      )}
    </div>
  );
}
