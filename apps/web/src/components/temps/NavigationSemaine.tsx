import Link from "next/link";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { creerTraduire } from "@missionpilot/shared";
import { Icone } from "../ui/Icone";
import { aujourdhuiIso, libelleSemaine, navigationSemaine } from "../../lib/semaine";

export interface NavigationSemaineProps {
  /** Chemin de la page (ex. « /planning »). */
  base: string;
  semaine: { debut: string; fin: string };
  /** Nom de la zone de navigation, ex. « Changer de semaine du planning ». */
  libelle: string;
}

/**
 * Navigation d'une semaine à l'autre par liens (l'état vit dans l'URL : partage, retour
 * arrière, reprise après coupure) et saut à une date par un formulaire GET sans JavaScript.
 */
export async function NavigationSemaine({ base, semaine, libelle }: NavigationSemaineProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const liens = navigationSemaine(base, semaine.debut, aujourdhuiIso());
  return (
    <nav className="mp-semaine-nav" aria-label={libelle}>
      <p className="mp-semaine-nav__titre" aria-live="polite">
        {libelleSemaine(semaine.debut, semaine.fin, langue)}
      </p>
      <ul className="mp-semaine-nav__liens">
        <li>
          <Link className="mp-pagination__lien" href={liens.precedente} prefetch={false}>
            <Icone nom="chevronGauche" taille={18} />
            <span>{t("Semaine précédente", "Previous week")}</span>
          </Link>
        </li>
        {liens.courante ? (
          <li>
            <Link className="mp-pagination__lien" href={liens.courante} prefetch={false}>
              <Icone nom="calendrier" taille={18} />
              <span>{t("Cette semaine", "This week")}</span>
            </Link>
          </li>
        ) : null}
        <li>
          <Link className="mp-pagination__lien" href={liens.suivante} prefetch={false}>
            <span>{t("Semaine suivante", "Next week")}</span>
            <Icone nom="chevronDroit" taille={18} />
          </Link>
        </li>
      </ul>
      <form method="get" action={base} className="mp-semaine-nav__saut">
        <label className="mp-semaine-nav__libelle" htmlFor={`saut-${base.replace(/\W/g, "")}`}>
          {t("Aller à la semaine du", "Go to the week of")}
        </label>
        <div className="mp-semaine-nav__ligne">
          <input
            id={`saut-${base.replace(/\W/g, "")}`}
            className="mp-champ__controle"
            type="date"
            name="semaine"
            min="2000-01-01"
            max="2100-12-31"
            defaultValue={semaine.debut}
            required
          />
          <button type="submit" className="mp-bouton mp-bouton--secondaire">
            <span>{t("Afficher", "Show")}</span>
          </button>
        </div>
      </form>
    </nav>
  );
}
