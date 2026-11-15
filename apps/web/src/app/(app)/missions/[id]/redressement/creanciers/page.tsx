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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { aujourdhui as aujourdhuiIso } from "../../../../../../lib/periode";
import {
  BANDEAU_CONFIDENTIALITE,
  BANDEAU_CONFIDENTIALITE_EN,
  cheminCreanciers,
  formaterPart,
  hrefRedressement,
  raisonSansEcriture,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Créanciers du redressement", "Turnaround creditors") };
}

type FiltreActifs = "true" | "false" | "tous";

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const FILTRES: { valeur: FiltreActifs; libelle: string }[] = [
    { valeur: "true", libelle: t("Actifs", "Active") },
    { valeur: "false", libelle: t("Inactifs", "Inactive") },
    { valeur: "tous", libelle: t("Tous", "All") },
  ];
  const actifs = lireActifs((await searchParams).actifs);
  const base = hrefRedressement(id, "creanciers");
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return <EtatContexteRed contexte={ctx} missionId={id} hrefReessayer={base} />;
  }
  const { mission, dossier, droits } = ctx;
  const r = await chargerServeur<RedCreanciersVue>(cheminCreanciers(dossier.id, actifs));
  const m = (v: number) => formaterMontantMineur(v, dossier.devise, langue);

  return (
    <div className="mp-red">
      <Alerte tonalite="info" annonce="aucune">
        <p>{t(BANDEAU_CONFIDENTIALITE, BANDEAU_CONFIDENTIALITE_EN)}</p>
      </Alerte>

      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Le registre des créanciers n'a pas pu être chargé.",
            "The creditor register could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={base}
        />
      ) : (
        <>
          <div className="mp-red-cartes">
            <Carte titre={t("Total dû", "Total due")} niveauTitre={3}>
              <p className="mp-red-chiffre mp-red-valeur">{m(r.donnees.synthese.total_encours)}</p>
            </Carte>
            <Carte titre={t("Dont échu", "Of which overdue")} niveauTitre={3}>
              <p className="mp-red-chiffre mp-red-valeur">{m(r.donnees.synthese.total_echu)}</p>
            </Carte>
            <Carte titre={t("Part garantie", "Secured share")} niveauTitre={3}>
              <p className="mp-red-chiffre">
                {formaterPart(r.donnees.synthese.part_garantie_pb, langue)}
              </p>
            </Carte>
            <Carte
              titre={t("Concentration des trois plus gros", "Concentration of the three largest")}
              niveauTitre={3}
            >
              <p className="mp-red-chiffre">
                {formaterPart(r.donnees.synthese.concentration_top3_pb, langue)}
              </p>
              <p className="mp-texte-doux mp-texte-petit">
                {t("Situation au", "Position as of")}{" "}
                {formaterDate(r.donnees.date_reference, "UTC", langue)}.
              </p>
            </Carte>
          </div>

          <nav
            aria-label={t("Filtrer les créanciers", "Filter creditors")}
            className="mp-filtre-segments"
          >
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
            <EtatVide
              titre={t("Aucun créancier enregistré.", "No creditor recorded.")}
              icone="dossier"
            >
              <p>{t("Aucun créancier enregistré.", "No creditor recorded.")}</p>
            </EtatVide>
          ) : (
            <ListeCreanciers missionId={id} elements={r.donnees.elements} devise={dossier.devise} />
          )}
        </>
      )}

      {droits.ecrire ? (
        <Carte titre={t("Ajouter un créancier", "Add a creditor")}>
          <FormulaireCreancier
            dossierId={dossier.id}
            devise={dossier.devise}
            aujourdhui={aujourdhuiIso()}
          />
        </Carte>
      ) : (
        <p className="mp-texte-doux">
          {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}
        </p>
      )}
    </div>
  );
}
